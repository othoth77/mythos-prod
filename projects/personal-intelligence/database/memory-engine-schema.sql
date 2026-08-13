-- =============================================================================
-- Mythos Personal Intelligence — Memory Engine Schema Delta (Draft)
-- Stage:   MPI-2-DESIGN-GATE — Personal Learning & Memory Engine
-- Date:    2026-08-12
-- Schema:  mythos_intelligence — the SAME separate logical schema already
--          established by control-plane-schema.sql (MPI-0). This file is a
--          DELTA on that file, not a replacement.
--
-- STATUS: DRAFT — NOT APPLIED. NOT EXECUTED. NOT DEPLOYED.
-- No table has been created, no row inserted, no migration written. Applying
-- any of this is MPI-2A and requires separate explicit authorisation, and is
-- itself blocked on owner decisions D1, D2 and D3 in
-- docs/MYTHOS_MEMORY_ENGINE_ARCHITECTURE.md §12.
--
-- WHAT IS DELIBERATELY ABSENT
--   There is no person, contact, organisation-entity, project or relationship
--   table here. Those are blocked on D1 (may this schema hold raw third-party
--   names, emails and phone numbers, which control-plane-schema.sql currently
--   forbids outright) and D2 (may MPI originate entities, when
--   pi_entity_references is specified as pointing at product-owned entities and
--   "never duplicates them"). Drafting them now would prejudge a privacy
--   decision that belongs to the owner.
--
-- Design rules inherited unchanged from control-plane-schema.sql:
--   - No secret-value column anywhere. A credential is rejected at capture and
--     never reaches storage in any form, summarised or hashed.
--   - No raw personal-data column. Identifiers are opaque references.
--   - No cross-schema foreign keys. References into product schemas are opaque
--     ref columns with a comment.
--   - All timestamps TIMESTAMPTZ, stored and interpreted as UTC.
--   - BIGSERIAL internal PK paired with a stable opaque VARCHAR external id.
--   - Content is stored BY REFERENCE (content_reference, URI/hash), never
--     embedded. Where that content physically lives is owner decision D3.
--   - organisation_id and domain_id present on every scoped row.
--   - Append-only tables define no UPDATE or DELETE path.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 16. Memory Provenance
--     One row per durable memory record. IMMUTABLE: correcting a memory creates
--     a NEW memory with new provenance plus a supersession link, never an edit.
--     import_batch_ref exists so an entire import can be reversed — an
--     un-undoable import of third-party personal data is not an acceptable
--     position to be in.
-- -----------------------------------------------------------------------------
CREATE TABLE pi_memory_provenance (
    memory_provenance_pk    BIGSERIAL     PRIMARY KEY,
    memory_provenance_id    VARCHAR(64)   NOT NULL UNIQUE,   -- stable opaque external id
    memory_record_id        VARCHAR(64)   NOT NULL,          -- ref: pi_memory_records.memory_record_id
    provider                VARCHAR(32)   NOT NULL,          -- google / openai / anthropic / deepseek / gemini / notebooklm / mythos
    source_type             VARCHAR(32)   NOT NULL,          -- contacts / conversation / file / note / observation / explicit_instruction / feedback
    source_reference        VARCHAR(256),                    -- opaque id/URI/hash of the originating artefact — never its content
    import_batch_ref        VARCHAR(64),                     -- groups one import so it can be reversed wholesale
    captured_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- when Mythos recorded it (UTC)
    observed_at             TIMESTAMPTZ,                     -- when the fact was true/stated, where distinct (UTC)
    confidence              VARCHAR(16)   NOT NULL DEFAULT 'LOW',  -- LOW / MEDIUM / HIGH / EXPLICIT
    actor_ref               VARCHAR(64),                     -- opaque usr_*/svc_* reference, no PII
    actor_type              VARCHAR(16),                     -- HUMAN / SYSTEM
    created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC — row is never updated after insert
);

CREATE INDEX idx_pi_provenance_memory   ON pi_memory_provenance (memory_record_id);
CREATE INDEX idx_pi_provenance_batch    ON pi_memory_provenance (import_batch_ref);
CREATE INDEX idx_pi_provenance_source   ON pi_memory_provenance (provider, source_type);


-- -----------------------------------------------------------------------------
-- 17. Memory Conflicts
--     Contradictory facts are NEVER silently overwritten. Both memory rows
--     persist and this table records the contradiction. Resolution is explicit
--     (user instruction, or a binding precedence rule) — see D4 for whether
--     automatic precedence resolution is permitted at all.
-- -----------------------------------------------------------------------------
CREATE TABLE pi_memory_conflicts (
    memory_conflict_pk      BIGSERIAL     PRIMARY KEY,
    memory_conflict_id      VARCHAR(64)   NOT NULL UNIQUE,   -- stable opaque external id
    user_id                 VARCHAR(64)   NOT NULL,          -- ref: pi_users.user_id
    organisation_id         VARCHAR(64)   NOT NULL,          -- ref: pi_organisations.organisation_id
    domain_id               VARCHAR(64),                     -- ref: pi_domains.domain_id, where applicable
    memory_record_id_a      VARCHAR(64)   NOT NULL,          -- ref: pi_memory_records.memory_record_id
    memory_record_id_b      VARCHAR(64)   NOT NULL,          -- ref: pi_memory_records.memory_record_id
    conflict_reason         VARCHAR(64)   NOT NULL,          -- SAME_KEY_DIFFERENT_VALUE / TEMPORAL_OVERLAP / SOURCE_DISAGREEMENT
    resolution_state        VARCHAR(16)   NOT NULL DEFAULT 'open',  -- open / resolved / abandoned
    resolved_by_ref         VARCHAR(64),                     -- opaque actor reference when resolved
    resolution_summary      VARCHAR(512),                    -- no raw sensitive content
    detected_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    resolved_at             TIMESTAMPTZ,                     -- UTC
    created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    CONSTRAINT chk_pi_conflict_distinct CHECK (memory_record_id_a <> memory_record_id_b)
);

CREATE UNIQUE INDEX idx_pi_conflict_pair ON pi_memory_conflicts (memory_record_id_a, memory_record_id_b);
CREATE INDEX idx_pi_conflict_open        ON pi_memory_conflicts (user_id, resolution_state);


-- -----------------------------------------------------------------------------
-- 18. Memory Tombstones
--     Deletion is a tombstone, never a silent row removal. Retrieval excludes
--     tombstoned memory by default (includeStates defaults to ['active']).
--     APPEND-ONLY.
-- -----------------------------------------------------------------------------
CREATE TABLE pi_memory_tombstones (
    memory_tombstone_pk     BIGSERIAL     PRIMARY KEY,
    memory_tombstone_id     VARCHAR(64)   NOT NULL UNIQUE,   -- stable opaque external id
    memory_record_id        VARCHAR(64)   NOT NULL UNIQUE,   -- ref: pi_memory_records.memory_record_id
    user_id                 VARCHAR(64)   NOT NULL,          -- ref: pi_users.user_id
    organisation_id         VARCHAR(64)   NOT NULL,          -- ref: pi_organisations.organisation_id
    deletion_reason         VARCHAR(32)   NOT NULL,          -- USER_REQUEST / RETENTION_EXPIRY / IMPORT_REVERSAL / POLICY
    requested_by_ref        VARCHAR(64),                     -- opaque actor reference, no PII
    import_batch_ref        VARCHAR(64),                     -- set when the deletion reverses a whole import
    deleted_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC — row is never updated or deleted after insert
);

CREATE INDEX idx_pi_tombstone_user  ON pi_memory_tombstones (user_id);
CREATE INDEX idx_pi_tombstone_batch ON pi_memory_tombstones (import_batch_ref);


-- -----------------------------------------------------------------------------
-- 19. Memory Tags
--     Retrieval narrowing only. A tag is a label, never a permission: it must
--     never be used to grant or widen access.
-- -----------------------------------------------------------------------------
CREATE TABLE pi_memory_tags (
    memory_tag_pk           BIGSERIAL     PRIMARY KEY,
    memory_tag_id           VARCHAR(64)   NOT NULL UNIQUE,   -- stable opaque external id
    memory_record_id        VARCHAR(64)   NOT NULL,          -- ref: pi_memory_records.memory_record_id
    tag_key                 VARCHAR(64)   NOT NULL,          -- normalised lowercase label
    created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

CREATE UNIQUE INDEX idx_pi_tag_unique ON pi_memory_tags (memory_record_id, tag_key);
CREATE INDEX idx_pi_tag_key           ON pi_memory_tags (tag_key);


-- -----------------------------------------------------------------------------
-- 20. Memory Events (timeline)
--     Time-anchored occurrences: decisions, goals reached, routine executions,
--     long-term project state changes. valid_from/valid_to give a fact a
--     validity window, so "he lives in Tunis" can become historical rather
--     than simply wrong.
-- -----------------------------------------------------------------------------
CREATE TABLE pi_memory_events (
    memory_event_pk         BIGSERIAL     PRIMARY KEY,
    memory_event_id         VARCHAR(64)   NOT NULL UNIQUE,   -- stable opaque external id
    memory_record_id        VARCHAR(64),                     -- ref: pi_memory_records.memory_record_id, where the event derives from one
    user_id                 VARCHAR(64)   NOT NULL,          -- ref: pi_users.user_id
    organisation_id         VARCHAR(64)   NOT NULL,          -- ref: pi_organisations.organisation_id
    domain_id               VARCHAR(64),                     -- ref: pi_domains.domain_id, where applicable
    project_ref             VARCHAR(64),                     -- opaque project reference; MPI does not own projects (see D2)
    event_type              VARCHAR(32)   NOT NULL,          -- DECISION / GOAL / ROUTINE / PROJECT_STATE / MILESTONE
    event_summary           VARCHAR(512)  NOT NULL,          -- short, non-sensitive summary
    content_reference       VARCHAR(256),                    -- URI/hash reference to detail, never embedded (see D3)
    occurred_at             TIMESTAMPTZ   NOT NULL,          -- UTC
    valid_from              TIMESTAMPTZ,                     -- UTC — start of the window in which this holds
    valid_to                TIMESTAMPTZ,                     -- UTC — NULL means still current
    created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    CONSTRAINT chk_pi_event_window CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE INDEX idx_pi_event_user_time ON pi_memory_events (user_id, occurred_at DESC);
CREATE INDEX idx_pi_event_project   ON pi_memory_events (project_ref);
CREATE INDEX idx_pi_event_type      ON pi_memory_events (event_type);


-- -----------------------------------------------------------------------------
-- 21. Additive columns on existing MPI-0 tables
--     Stated as intent only. No ALTER is executed by this file.
-- -----------------------------------------------------------------------------
--   pi_memory_records:
--     state                    VARCHAR(16)  NOT NULL DEFAULT 'active'
--                              -- active / superseded / disputed / tombstoned.
--                              -- possible_match is deliberately NOT a memory
--                              -- state: it is an entity-resolution outcome, and
--                              -- conflating the two would let an unresolved
--                              -- identity masquerade as a disputed fact.
--     supersedes_memory_id     VARCHAR(64)  -- ref: pi_memory_records.memory_record_id
--     superseded_at            TIMESTAMPTZ  -- UTC
--     observed_at              TIMESTAMPTZ  -- UTC, where distinct from created_at
--     valid_from / valid_to    TIMESTAMPTZ  -- UTC validity window
--     evidence_count           INTEGER      NOT NULL DEFAULT 1
--                              -- incremented ONLY by an INDEPENDENT observation
--                              -- (different source_reference, or the same source
--                              -- at a materially later observed_at). Re-importing
--                              -- the same file twice must count once, or
--                              -- confidence measures verbosity rather than truth.
-- =============================================================================
-- END OF DRAFT DELTA — 5 new tables, plus additive columns stated as intent.
-- Nothing here has been applied. MPI-2A is blocked on D1, D2 and D3.
-- =============================================================================
