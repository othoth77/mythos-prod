-- =============================================================================
-- Mythos Personal Intelligence & Skills Platform — Control Plane Schema (Draft)
-- Stage:   MPI-0 — Personal Intelligence Foundation
-- Date:    2026-08-06
-- Schema:  mythos_intelligence (separate logical schema; not idauto / autovaleur /
--          mythos_automotive / atelier_network / mythos_automation — no cross-
--          schema FKs, following the pattern in projects/automation/database/
--          control-plane-schema.sql and MAD-1/MAD-4 in
--          docs/AUTOMOTIVE_ARCHITECTURE.md).
--
-- STATUS: DRAFT — NOT DEPLOYED. NOT EXECUTED.
-- Documents the intended control-plane data model for Mythos Personal
-- Intelligence (product_key: mythos_intelligence). No migration script exists
-- yet. No table has been created. No row has been inserted. Provisioning
-- requires explicit authorisation in a future implementation stage (MPI-1 or
-- later), subject to the one-major-stage governance rule in docs/ROADMAP.md.
--
-- Table count: 15 (all prefixed pi_)
--
-- Design rules applied throughout this file:
--   - No secret-value column anywhere. Credentials belong exclusively to
--     aut_secret_references (projects/automation/database/control-plane-schema.sql);
--     this schema never stores one.
--   - No raw personal-data column. Every user/organisation-facing identifier
--     is an opaque reference (user_ref, organisation_ref, actor_ref), never a
--     name, email, or phone number — see docs/MYTHOS_AI_MULTI_TENANCY.md §6.
--   - organization_id and domain_id are present on every row that is
--     organisation- or domain-scoped, enforcing the isolation rules in
--     docs/MYTHOS_AI_MULTI_TENANCY.md at the schema level, not only in the
--     application layer.
--   - No cross-schema foreign keys. Cross-schema references (e.g. to a real
--     organisation or user entity owned by a product schema) are opaque ref
--     columns with a comment, exactly as established elsewhere in this
--     repository.
--   - All timestamps are TIMESTAMPTZ, stored and interpreted as UTC.
--   - Primary keys are BIGSERIAL (internal) paired with a stable opaque
--     external identifier column (VARCHAR) for audit/reference stability.
--   - Memory and context content is stored by reference (content_reference,
--     URI/hash) with an is_redacted flag, never embedded raw where the
--     content could be large or sensitive — mirroring aut_snapshots.
--   - Every learned-preference row carries scope, confidence/evidence
--     metadata, and a supersedes pointer — see docs/MYTHOS_USER_MEMORY_POLICY.md.
--   - pi_preference_audit and pi_guard_decisions are append-only by
--     specification: no UPDATE or DELETE path is defined for them in this or
--     any future stage without a separate, explicit governance amendment.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Domains
--    Registry of Domain Profiles (docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md §3).
-- -----------------------------------------------------------------------------
CREATE TABLE pi_domains (
    domain_pk              BIGSERIAL PRIMARY KEY,
    domain_id                  VARCHAR(64)   NOT NULL UNIQUE,      -- stable opaque external id, e.g. 'education'
    display_name                  VARCHAR(128)  NOT NULL,
    terminology_reference             VARCHAR(256),                        -- URI/hash reference to terminology baseline, never embedded
    required_context_keys                TEXT[],                              -- e.g. '{teacher.context, calendar.context}'
    optional_context_keys                   TEXT[],
    policy_reference_ids                       TEXT[],                              -- ref ids into docs/*, not embedded
    enabled                                       BOOLEAN       NOT NULL DEFAULT FALSE,
    created_at                                      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    updated_at                                        TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 2. Domain Capabilities
--    Capability contracts a domain exposes (docs/MYTHOS_DOMAIN_PACKS.md).
-- -----------------------------------------------------------------------------
CREATE TABLE pi_domain_capabilities (
    capability_pk            BIGSERIAL PRIMARY KEY,
    capability_id                VARCHAR(64)   NOT NULL UNIQUE,      -- stable opaque id, e.g. 'assessment.prepare'
    domain_id                        VARCHAR(64)   NOT NULL,             -- ref: pi_domains.domain_id
    display_name                        VARCHAR(256)  NOT NULL,
    default_automation_level               VARCHAR(32)   NOT NULL,             -- reuses LEVEL_1..LEVEL_4 vocabulary, see docs/AUTOMATION_ARCHITECTURE.md §2
    is_mutating                               BOOLEAN       NOT NULL DEFAULT FALSE,
    runtime_available                            BOOLEAN       NOT NULL DEFAULT FALSE, -- FALSE for every capability as of MPI-0
    created_at                                     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    updated_at                                       TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 3. Organisations
--    Registry of Organisation Profiles (docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md §4).
--    organisation_ref points to the real organisation entity owned by a
--    product schema (e.g. atelier_network.atn_workshop_organizations) — no
--    cross-schema FK, opaque reference only.
-- -----------------------------------------------------------------------------
CREATE TABLE pi_organisations (
    organisation_pk         BIGSERIAL PRIMARY KEY,
    organisation_id             VARCHAR(64)   NOT NULL UNIQUE,      -- stable opaque external id
    organisation_ref                VARCHAR(64)   NOT NULL,             -- opaque ref into the owning product schema
    organisation_ref_source            VARCHAR(64)   NOT NULL,             -- e.g. 'atelier_network', 'education_product' — external IDs stored with source
    domain_id                             VARCHAR(64)   NOT NULL,             -- ref: pi_domains.domain_id
    terminology_override_reference           VARCHAR(256),                        -- URI/hash reference, never embedded
    enabled_capability_ids                       TEXT[],
    disabled_capability_ids                         TEXT[],
    automation_policy_ceiling                          VARCHAR(32)   NOT NULL DEFAULT 'LEVEL_1_READ_ONLY',
    ai_configuration_reference                            VARCHAR(256),                        -- URI/hash reference
    privacy_policy_reference_ids                             TEXT[],
    created_at                                                  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    updated_at                                                    TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 4. Users
--    Registry of User Profiles / Personal AI Profiles
--    (docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md §5). user_ref points to
--    the real user/account entity owned by Mythos OS core — opaque, no FK.
-- -----------------------------------------------------------------------------
CREATE TABLE pi_users (
    user_pk                   BIGSERIAL PRIMARY KEY,
    user_id                       VARCHAR(64)   NOT NULL UNIQUE,      -- stable opaque external id
    user_ref                         VARCHAR(64)   NOT NULL,             -- opaque ref into the owning auth/account system
    user_ref_source                     VARCHAR(64)   NOT NULL,             -- e.g. 'mythos_os_core'
    organisation_id                        VARCHAR(64)   NOT NULL,             -- ref: pi_organisations.organisation_id
    locale                                    VARCHAR(16),
    preferred_languages                          TEXT[],                              -- ordered, e.g. '{ar-TN, fr, en}'
    memory_enabled                                  BOOLEAN       NOT NULL DEFAULT TRUE,   -- user-controllable, see docs/SKILLS_ROADMAP.md MPI-8
    created_at                                        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    updated_at                                          TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 5. User Domain Access
--    Which domains/roles a user is active in — NEVER a substitute for the
--    real permission system (docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md
--    §6, User ≠ Role). role_ref is a pointer to the authoritative role record,
--    not a duplicate of permission logic.
-- -----------------------------------------------------------------------------
CREATE TABLE pi_user_domain_access (
    user_domain_access_pk      BIGSERIAL PRIMARY KEY,
    user_id                        VARCHAR(64)   NOT NULL,             -- ref: pi_users.user_id
    domain_id                          VARCHAR(64)   NOT NULL,             -- ref: pi_domains.domain_id
    organisation_id                        VARCHAR(64)   NOT NULL,             -- ref: pi_organisations.organisation_id
    role_ref                                  VARCHAR(64)   NOT NULL,             -- opaque ref to the authoritative role/permission record
    role_ref_source                              VARCHAR(64)   NOT NULL,             -- e.g. 'mythos_os_core'
    is_active                                       BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at                                         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    updated_at                                           TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 6. Sessions
--    Session Context (docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md §9).
--    Never stores an infinite transcript — see temporary_context_reference.
-- -----------------------------------------------------------------------------
CREATE TABLE pi_sessions (
    session_pk                 BIGSERIAL PRIMARY KEY,
    session_id                     VARCHAR(64)   NOT NULL UNIQUE,      -- stable opaque external id
    user_id                             VARCHAR(64)   NOT NULL,             -- ref: pi_users.user_id
    organisation_id                        VARCHAR(64)   NOT NULL,             -- ref: pi_organisations.organisation_id
    active_domain_id                          VARCHAR(64),                        -- ref: pi_domains.domain_id
    current_intent_summary                        VARCHAR(512),                        -- short summary only, no raw sensitive content
    temporary_context_reference                       VARCHAR(256),                        -- URI/hash reference to this-turn-only context, never embedded
    started_at                                           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    last_activity_at                                       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    closed_at                                                TIMESTAMPTZ,
    created_at                                                 TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 7. Memory Records
--    Generic memory storage covering the seven types in
--    docs/MYTHOS_USER_MEMORY_POLICY.md §1 (A–G), distinguished by memory_type.
--    Content is stored by reference; is_redacted defaults TRUE.
-- -----------------------------------------------------------------------------
CREATE TABLE pi_memory_records (
    memory_record_pk            BIGSERIAL PRIMARY KEY,
    memory_record_id                 VARCHAR(64)   NOT NULL UNIQUE,      -- stable opaque external id
    user_id                              VARCHAR(64)   NOT NULL,             -- ref: pi_users.user_id
    organisation_id                          VARCHAR(64)   NOT NULL,             -- ref: pi_organisations.organisation_id
    domain_id                                    VARCHAR(64),                        -- ref: pi_domains.domain_id, where applicable
    memory_type                                     VARCHAR(32)   NOT NULL,             -- WORKING_PREFERENCE / WORKFLOW / DOMAIN_CONTEXT / ORG_KNOWLEDGE / TASK_HISTORY / DECISION / EPHEMERAL_SESSION
    scope                                              VARCHAR(16)   NOT NULL DEFAULT 'user', -- session / user / organisation / domain / global — see docs/MYTHOS_USER_MEMORY_POLICY.md §3
    content_summary                                       VARCHAR(512)  NOT NULL,             -- short, non-sensitive summary
    content_reference                                        VARCHAR(256),                        -- URI/hash reference to full content, never embedded
    is_redacted                                                 BOOLEAN       NOT NULL DEFAULT TRUE,
    session_id                                                    VARCHAR(64),                        -- ref: pi_sessions.session_id, for EPHEMERAL_SESSION rows
    expires_at                                                       TIMESTAMPTZ,                        -- ephemeral rows are time-bounded
    created_at                                                         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    updated_at                                                           TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 8. Learned Preferences
--    The confidence/evidence learning table (docs/MYTHOS_USER_MEMORY_POLICY.md
--    §2, §4). Rows are never destructively overwritten — a correction inserts
--    a new row referencing supersedes_preference_id.
-- -----------------------------------------------------------------------------
CREATE TABLE pi_learned_preferences (
    preference_pk                BIGSERIAL PRIMARY KEY,
    preference_id                     VARCHAR(64)   NOT NULL UNIQUE,      -- stable opaque external id
    user_id                               VARCHAR(64)   NOT NULL,             -- ref: pi_users.user_id
    organisation_id                           VARCHAR(64)   NOT NULL,             -- ref: pi_organisations.organisation_id
    domain_id                                     VARCHAR(64),                        -- ref: pi_domains.domain_id, where applicable
    scope                                             VARCHAR(16)   NOT NULL DEFAULT 'user', -- session / user / organisation / domain / global
    status                                               VARCHAR(32)   NOT NULL DEFAULT 'CANDIDATE_PREFERENCE', -- SESSION_OBSERVATION / CANDIDATE_PREFERENCE / ESTABLISHED_PREFERENCE / EXPLICIT_USER_RULE / SUPERSEDED / DISCARDED
    preference_key                                         VARCHAR(128)  NOT NULL,             -- e.g. 'assessment.answer_key.verbosity'
    preference_value_summary                                  VARCHAR(512)  NOT NULL,             -- short, non-sensitive summary; no raw sensitive content
    source                                                       VARCHAR(32)   NOT NULL,             -- OBSERVATION / EXPLICIT_INSTRUCTION / FEEDBACK_SIGNAL
    evidence_count                                                  INTEGER       NOT NULL DEFAULT 1,
    confidence                                                        VARCHAR(16)   NOT NULL DEFAULT 'LOW', -- LOW / MEDIUM / HIGH / EXPLICIT
    first_observed_at                                                    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    last_observed_at                                                       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    supersedes_preference_id                                                  VARCHAR(64),                        -- ref: pi_learned_preferences.preference_id
    expires_at                                                                   TIMESTAMPTZ,
    created_at                                                                     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    updated_at                                                                       TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 9. Preference Audit
--    APPEND-ONLY. Every meaningful state transition of a learned preference
--    (docs/MYTHOS_USER_MEMORY_POLICY.md §7 — correct, forget, override).
-- -----------------------------------------------------------------------------
CREATE TABLE pi_preference_audit (
    preference_audit_pk            BIGSERIAL PRIMARY KEY,
    preference_audit_id                 VARCHAR(64)   NOT NULL UNIQUE,      -- stable opaque external id
    preference_id                           VARCHAR(64)   NOT NULL,             -- ref: pi_learned_preferences.preference_id
    actor_ref                                   VARCHAR(64)   NOT NULL,             -- opaque actor reference (user or system), no PII
    actor_type                                     VARCHAR(16)   NOT NULL,             -- HUMAN / SYSTEM
    change_type                                       VARCHAR(32)   NOT NULL,             -- CREATED / PROMOTED / CORRECTED / SUPERSEDED / DISCARDED / EXPIRED
    previous_status                                      VARCHAR(32),
    new_status                                              VARCHAR(32)   NOT NULL,
    reason_summary                                             VARCHAR(512),                        -- no raw sensitive content
    occurred_at                                                  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    created_at                                                     TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC — row is never updated or deleted after insert
);

-- -----------------------------------------------------------------------------
-- 10. Entity References
--     Generic EntityReference registry (docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md
--     §10) — points at real entities owned by product schemas, never duplicates them.
-- -----------------------------------------------------------------------------
CREATE TABLE pi_entity_references (
    entity_reference_pk              BIGSERIAL PRIMARY KEY,
    entity_reference_id                   VARCHAR(64)   NOT NULL UNIQUE,      -- stable opaque external id
    entity_type                               VARCHAR(64)   NOT NULL,             -- e.g. 'teacher', 'vehicle', 'client', 'work_order'
    entity_external_id                            VARCHAR(256)  NOT NULL,             -- external id/name of the entity
    entity_external_source                            VARCHAR(64)   NOT NULL,             -- owning product schema, e.g. 'idauto', 'atelier_network'
    organisation_id                                       VARCHAR(64)   NOT NULL,             -- ref: pi_organisations.organisation_id
    permission_scope                                          VARCHAR(64)   NOT NULL,             -- e.g. 'organisation_private', 'user_private'
    created_at                                                   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    updated_at                                                     TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 11. Guard Decisions
--     APPEND-ONLY. Audit trail of every permission/automation-level decision
--     (docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md §11, docs/SKILLS_SECURITY.md).
--     Never itself grants access — a pure audit record of decisions made
--     elsewhere by the existing Mythos permission model.
-- -----------------------------------------------------------------------------
CREATE TABLE pi_guard_decisions (
    guard_decision_pk                  BIGSERIAL PRIMARY KEY,
    guard_decision_id                       VARCHAR(64)   NOT NULL UNIQUE,      -- stable opaque external id
    user_id                                     VARCHAR(64)   NOT NULL,             -- ref: pi_users.user_id
    organisation_id                                 VARCHAR(64)   NOT NULL,             -- ref: pi_organisations.organisation_id
    domain_id                                           VARCHAR(64),                        -- ref: pi_domains.domain_id
    capability_id                                           VARCHAR(64),                        -- ref: pi_domain_capabilities.capability_id
    automation_level_requested                                 VARCHAR(32)   NOT NULL,
    data_classification                                           VARCHAR(32),
    decision                                                        VARCHAR(24)   NOT NULL,             -- ALLOW / DENY / REQUIRE_APPROVAL / READ_ONLY / DRY_RUN_ONLY
    decided_at                                                         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    created_at                                                           TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC — row is never updated or deleted after insert
);

-- -----------------------------------------------------------------------------
-- 12. Context Packages
--     Reference-only audit record of a compiled ContextPackage
--     (docs/MYTHOS_CONTEXT_ARCHITECTURE.md §5) — never the raw package itself.
-- -----------------------------------------------------------------------------
CREATE TABLE pi_context_packages (
    context_package_pk                  BIGSERIAL PRIMARY KEY,
    context_package_id                       VARCHAR(64)   NOT NULL UNIQUE,      -- stable opaque external id
    session_id                                   VARCHAR(64)   NOT NULL,             -- ref: pi_sessions.session_id
    user_id                                          VARCHAR(64)   NOT NULL,             -- ref: pi_users.user_id
    organisation_id                                      VARCHAR(64)   NOT NULL,             -- ref: pi_organisations.organisation_id
    domain_id                                                VARCHAR(64),                        -- ref: pi_domains.domain_id
    package_reference                                            VARCHAR(256)  NOT NULL,             -- URI/hash reference to the full compiled package, never embedded
    required_fact_count                                             INTEGER,
    useful_fact_count                                                  INTEGER,
    excluded_forbidden_count                                             INTEGER,
    compiled_at                                                            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    created_at                                                               TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 13. Feedback Events
--     Safe feedback signals (docs/MYTHOS_USER_MEMORY_POLICY.md §8) that may
--     inform a candidate preference — never automatically a preference itself.
-- -----------------------------------------------------------------------------
CREATE TABLE pi_feedback_events (
    feedback_event_pk                    BIGSERIAL PRIMARY KEY,
    feedback_event_id                         VARCHAR(64)   NOT NULL UNIQUE,      -- stable opaque external id
    user_id                                       VARCHAR(64)   NOT NULL,             -- ref: pi_users.user_id
    organisation_id                                   VARCHAR(64)   NOT NULL,             -- ref: pi_organisations.organisation_id
    session_id                                            VARCHAR(64),                        -- ref: pi_sessions.session_id
    event_type                                               VARCHAR(32)   NOT NULL,             -- accepted_result / edited_result / rejected_result / repeated_action / explicit_preference / explicit_correction / workflow_completion
    related_capability_id                                        VARCHAR(64),                        -- ref: pi_domain_capabilities.capability_id
    summary                                                          VARCHAR(512),                        -- no raw sensitive content
    occurred_at                                                         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    created_at                                                            TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 14. Knowledge Sources
--     Registry of authorised personal/organisation knowledge sources
--     (docs/MYTHOS_CONTEXT_ARCHITECTURE.md §6). No connector is implemented;
--     this is the registry future connectors (see aut_connectors) attach to.
-- -----------------------------------------------------------------------------
CREATE TABLE pi_knowledge_sources (
    knowledge_source_pk                    BIGSERIAL PRIMARY KEY,
    knowledge_source_id                         VARCHAR(64)   NOT NULL UNIQUE,      -- stable opaque external id
    organisation_id                                 VARCHAR(64)   NOT NULL,             -- ref: pi_organisations.organisation_id
    source_type                                         VARCHAR(64)   NOT NULL,             -- e.g. 'user_documents', 'organisation_documents', 'course_material'
    connector_id                                            VARCHAR(64),                        -- ref: aut_connectors.connector_id (opaque, cross-schema, no FK)
    permission_scope                                            VARCHAR(64)   NOT NULL,
    enabled                                                        BOOLEAN       NOT NULL DEFAULT FALSE,
    created_at                                                       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    updated_at                                                         TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 15. Domain Capability Runtime Status
--     Explicit, per-organisation record of whether a shared domain capability
--     is actually reachable at runtime for that organisation — the mechanism
--     that lets the Superposer "fail closed" per docs/SKILLS_SUPERPOSER.md §3
--     rather than silently substituting a different capability.
-- -----------------------------------------------------------------------------
CREATE TABLE pi_capability_runtime_status (
    capability_runtime_status_pk              BIGSERIAL PRIMARY KEY,
    capability_id                                  VARCHAR(64)   NOT NULL,             -- ref: pi_domain_capabilities.capability_id
    organisation_id                                    VARCHAR(64)   NOT NULL,             -- ref: pi_organisations.organisation_id
    is_available                                           BOOLEAN       NOT NULL DEFAULT FALSE,
    unavailable_reason                                        VARCHAR(256),
    last_checked_at                                              TIMESTAMPTZ,
    created_at                                                      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    updated_at                                                        TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- =============================================================================
-- End of draft schema. 15 tables defined above, matching the header count.
-- =============================================================================
