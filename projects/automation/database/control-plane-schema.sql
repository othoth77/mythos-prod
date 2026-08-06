-- =============================================================================
-- Mythos Automation & Operations — Control Plane Schema (Draft)
-- Stage:   AUT-0 — Automation-First Master Foundation
-- Date:    2026-08-06
-- Schema:  mythos_automation (separate logical schema; not idauto / autovaleur /
--          mythos_automotive / atelier_network — no cross-schema FKs)
--
-- STATUS: DRAFT — NOT DEPLOYED. NOT EXECUTED.
-- This file documents the intended control-plane data model for Mythos
-- Automation & Operations (product_key: mythos_automation), the platform
-- capability underlying the Mythos Control Center operator product.
-- No migration script exists yet. No table has been created. No row has
-- been inserted. Provisioning requires explicit authorisation in a future
-- implementation stage (INF-OVH-API-0 or later).
--
-- Table count: 24 (all prefixed aut_)
--
-- Design rules applied throughout this file:
--   - No secret-value column anywhere (no token/password/private-key/API-key
--     VALUE column). Only secret_reference_id / metadata columns exist —
--     see aut_secret_references.
--   - No operational customer PII. No binary backup data. Snapshots, logs,
--     and artifacts are referenced by URI/hash, never embedded.
--   - organization_id and environment_id are included wherever the record is
--     organisation- or environment-scoped.
--   - No cross-schema foreign keys. Cross-schema references are stored as
--     opaque ref columns with a comment noting the owning schema, exactly as
--     established in projects/automotive/database/control-plane-schema.sql.
--   - All timestamps are TIMESTAMPTZ, stored and interpreted as UTC.
--   - Primary keys are BIGSERIAL (internal) paired with a stable opaque
--     external identifier column (e.g. run_id, automation_id) of type
--     VARCHAR, so external systems and audit trails never depend on the
--     internal serial value.
--   - aut_audit_events is append-only by specification: no UPDATE or DELETE
--     path is defined for it in this or any future stage without a separate,
--     explicit governance amendment.
--   - Approval history is preserved in aut_approvals (append rows, never
--     overwrite a prior decision).
--   - Automation level, run status, dry_run, idempotency key, and rollback
--     reference are explicit, first-class columns wherever they apply —
--     never inferred from other fields.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Environments
--    Registry of environments an automation run can target (e.g. production,
--    staging, sandbox). Distinct from any specific product's own environment
--    concept — this is the automation platform's environment registry.
-- -----------------------------------------------------------------------------
CREATE TABLE aut_environments (
    environment_pk       BIGSERIAL PRIMARY KEY,
    environment_id        VARCHAR(64)   NOT NULL UNIQUE,     -- stable opaque external id
    environment_key        VARCHAR(64)   NOT NULL UNIQUE,     -- e.g. 'production', 'staging', 'sandbox'
    display_name           VARCHAR(128)  NOT NULL,
    organization_id         VARCHAR(64),                        -- opaque; no FK across schemas
    risk_class              VARCHAR(32)   NOT NULL,             -- LOW / STANDARD / HIGH / CRITICAL
    is_production           BOOLEAN       NOT NULL DEFAULT FALSE,
    enabled                 BOOLEAN       NOT NULL DEFAULT FALSE,
    notes                   TEXT,
    created_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    updated_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 2. Connectors
--    Registry of external-provider connectors (OVHcloud, Cloudflare, GitHub,
--    Coolify, PostgreSQL, object storage, n8n, email, etc.). See
--    docs/AUTOMATION_ARCHITECTURE.md section "Connector Model" for the full
--    catalogue. No credential value is ever stored here — only a reference
--    into aut_secret_references.
-- -----------------------------------------------------------------------------
CREATE TABLE aut_connectors (
    connector_pk          BIGSERIAL PRIMARY KEY,
    connector_id            VARCHAR(64)   NOT NULL UNIQUE,     -- stable opaque external id, e.g. 'ovh_readonly'
    provider                 VARCHAR(64)   NOT NULL,             -- e.g. 'OVHcloud', 'Cloudflare', 'GitHub'
    connector_type            VARCHAR(64)   NOT NULL,             -- e.g. 'infrastructure', 'business', 'communication'
    environment_id            VARCHAR(64)   NOT NULL,             -- ref: aut_environments.environment_id
    organization_scope         VARCHAR(64),                        -- opaque; no FK across schemas
    authentication_method       VARCHAR(64)   NOT NULL,             -- e.g. 'api_token', 'oauth2', 'service_account'
    secret_reference_id          VARCHAR(64),                        -- ref: aut_secret_references.secret_reference_id — NEVER a value
    rate_limit_per_minute          INTEGER,
    timeout_seconds                  INTEGER       NOT NULL DEFAULT 30,
    retry_policy_key                  VARCHAR(64),                        -- ref: retry policy defined in automation.example.json
    health_status                      VARCHAR(32)   NOT NULL DEFAULT 'UNKNOWN', -- HEALTHY / DEGRADED / UNHEALTHY / UNKNOWN
    last_successful_check_at            TIMESTAMPTZ,
    legal_classification                  VARCHAR(64),                        -- e.g. 'infrastructure_provider'
    security_classification                 VARCHAR(64),                        -- e.g. 'privileged', 'read_only'
    enabled                                   BOOLEAN       NOT NULL DEFAULT FALSE,
    owner_ref                                   VARCHAR(64),                        -- opaque operator/owner reference, no PII
    rollback_capability                           VARCHAR(32)   NOT NULL DEFAULT 'NONE', -- NONE / PARTIAL / FULL
    audit_policy_key                                VARCHAR(64),                        -- ref: audit policy defined in automation.example.json
    created_at                                        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    updated_at                                        TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 3. Connector Capabilities
--    Explicit, least-privilege capability grants per connector. Read and
--    write capabilities are never combined automatically — each capability
--    is its own row with its own approval trail.
-- -----------------------------------------------------------------------------
CREATE TABLE aut_connector_capabilities (
    capability_pk         BIGSERIAL PRIMARY KEY,
    capability_id            VARCHAR(64)   NOT NULL UNIQUE,     -- stable opaque external id
    connector_id               VARCHAR(64)   NOT NULL,             -- ref: aut_connectors.connector_id
    capability_key                VARCHAR(64)   NOT NULL,             -- e.g. 'dns.read', 'dns.write', 'zone.list'
    granted_permission               VARCHAR(64)   NOT NULL,             -- e.g. 'READ_ONLY', 'WRITE_SCOPED', 'ADMIN'
    automation_level_ceiling            VARCHAR(32)   NOT NULL,             -- highest automation level this capability may run at
    requires_approval_policy_id           VARCHAR(64),                        -- ref: aut_approval_policies.approval_policy_id
    enabled                                 BOOLEAN       NOT NULL DEFAULT FALSE,
    granted_at                                TIMESTAMPTZ,
    revoked_at                                  TIMESTAMPTZ,
    notes                                         TEXT,
    created_at                                      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    updated_at                                      TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 4. Secret References
--    Metadata-only registry of secrets held in an external secret manager,
--    Coolify encrypted environment variables, or VPS environment variables.
--    NEVER stores a token, password, private key, recovery code, or API
--    secret value. See docs/AUTOMATION_SECURITY_AND_SECRETS.md.
-- -----------------------------------------------------------------------------
CREATE TABLE aut_secret_references (
    secret_reference_pk    BIGSERIAL PRIMARY KEY,
    secret_reference_id       VARCHAR(64)   NOT NULL UNIQUE,     -- stable opaque external id — NOT the secret
    provider                    VARCHAR(64)   NOT NULL,             -- e.g. 'coolify_env', 'approved_secret_manager'
    purpose                       VARCHAR(256)  NOT NULL,             -- human-readable purpose, no value
    environment_id                  VARCHAR(64)   NOT NULL,             -- ref: aut_environments.environment_id
    owner_ref                         VARCHAR(64),                        -- opaque owner reference, no PII
    rotation_policy                     VARCHAR(64),                        -- e.g. 'every_90_days', 'manual'
    status                                 VARCHAR(32)   NOT NULL DEFAULT 'ACTIVE', -- ACTIVE / ROTATING / EXPIRED / REVOKED
    created_at                               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    rotated_at                                 TIMESTAMPTZ,
    expires_at                                   TIMESTAMPTZ,
    updated_at                                     TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
    -- NOTE: no "value", "token", "password", or "secret" column exists or may
    -- ever be added to this table. Enforcing this is a permanent schema rule.
);

-- -----------------------------------------------------------------------------
-- 5. Automation Definitions
--    Registry of automation workflows (the reusable, versioned definition —
--    not a specific run). Each definition declares its default automation
--    level; a run may only execute at that level or lower unless an audited
--    policy change raises it.
-- -----------------------------------------------------------------------------
CREATE TABLE aut_automation_definitions (
    automation_pk          BIGSERIAL PRIMARY KEY,
    automation_id             VARCHAR(64)   NOT NULL UNIQUE,     -- stable opaque external id
    automation_key               VARCHAR(64)   NOT NULL UNIQUE,     -- e.g. 'ovh_dns_snapshot'
    display_name                    VARCHAR(256)  NOT NULL,
    description                       TEXT,
    default_automation_level             VARCHAR(32)   NOT NULL,             -- LEVEL_1_READ_ONLY .. LEVEL_4_FULL_AUTOMATIC
    default_approval_policy_id             VARCHAR(64),                        -- ref: aut_approval_policies.approval_policy_id
    connector_id                             VARCHAR(64),                        -- ref: aut_connectors.connector_id (primary connector, if any)
    organization_scope                         VARCHAR(64),                        -- opaque; no FK across schemas
    is_mutating                                  BOOLEAN       NOT NULL DEFAULT FALSE,
    supports_dry_run                               BOOLEAN       NOT NULL DEFAULT TRUE,
    supports_rollback                                BOOLEAN       NOT NULL DEFAULT FALSE,
    enabled                                            BOOLEAN       NOT NULL DEFAULT FALSE,
    owner_ref                                            VARCHAR(64),
    created_at                                             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    updated_at                                             TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 6. Automation Versions
--    Immutable version history of an automation definition. A run always
--    references a specific automation_version, never just the definition,
--    so behaviour is reproducible and auditable.
-- -----------------------------------------------------------------------------
CREATE TABLE aut_automation_versions (
    automation_version_pk   BIGSERIAL PRIMARY KEY,
    automation_version_id      VARCHAR(64)   NOT NULL UNIQUE,     -- stable opaque external id
    automation_id                 VARCHAR(64)   NOT NULL,             -- ref: aut_automation_definitions.automation_id
    version_number                   VARCHAR(32)   NOT NULL,             -- e.g. 'v1.0.0'
    definition_snapshot_ref             VARCHAR(256)  NOT NULL,             -- URI/hash reference to the versioned workflow definition — never embedded
    automation_level                       VARCHAR(32)   NOT NULL,             -- level this version is approved to run at
    is_active                                BOOLEAN       NOT NULL DEFAULT FALSE,
    superseded_by_version_id                   VARCHAR(64),                        -- ref: aut_automation_versions.automation_version_id
    published_at                                 TIMESTAMPTZ,
    created_at                                     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    updated_at                                       TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 7. Approval Policies
--    Named, versionable approval policies referenced by automation
--    definitions, connector capabilities, and individual runs. Encodes
--    separation-of-duties and expiry rules.
-- -----------------------------------------------------------------------------
CREATE TABLE aut_approval_policies (
    approval_policy_pk       BIGSERIAL PRIMARY KEY,
    approval_policy_id          VARCHAR(64)   NOT NULL UNIQUE,     -- stable opaque external id
    policy_key                     VARCHAR(64)   NOT NULL UNIQUE,     -- e.g. 'dns_nameserver_change'
    display_name                      VARCHAR(256)  NOT NULL,
    required_approval_count              INTEGER       NOT NULL DEFAULT 1,
    allow_self_approval                     BOOLEAN       NOT NULL DEFAULT FALSE, -- must be FALSE wherever separation of duties is required
    approval_expiry_seconds                   INTEGER,                             -- NULL = never expires; expired approvals cannot be reused
    minimum_automation_level_covered            VARCHAR(32)   NOT NULL DEFAULT 'LEVEL_3_APPROVAL_REQUIRED',
    is_permanent_boundary                         BOOLEAN       NOT NULL DEFAULT FALSE, -- TRUE for the permanent LEVEL_3 boundary list
    enabled                                         BOOLEAN       NOT NULL DEFAULT TRUE,
    notes                                             TEXT,
    created_at                                          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    updated_at                                          TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 8. Schedules
--    Recurring or one-off trigger definitions for an automation version.
-- -----------------------------------------------------------------------------
CREATE TABLE aut_schedules (
    schedule_pk              BIGSERIAL PRIMARY KEY,
    schedule_id                 VARCHAR(64)   NOT NULL UNIQUE,     -- stable opaque external id
    automation_id                  VARCHAR(64)   NOT NULL,             -- ref: aut_automation_definitions.automation_id
    environment_id                    VARCHAR(64)   NOT NULL,             -- ref: aut_environments.environment_id
    organization_id                      VARCHAR(64),                        -- opaque; no FK across schemas
    schedule_type                           VARCHAR(32)   NOT NULL,             -- CRON / INTERVAL / ONE_OFF / EVENT_TRIGGERED
    schedule_expression                        VARCHAR(128),                        -- cron expression or interval descriptor
    timezone                                     VARCHAR(64)   NOT NULL DEFAULT 'UTC',
    next_run_at                                    TIMESTAMPTZ,
    enabled                                          BOOLEAN       NOT NULL DEFAULT FALSE,
    created_at                                         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    updated_at                                           TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 9. Runs
--    One row per automation execution. Carries every required execution
--    field from docs/AUTOMATION_ARCHITECTURE.md section "Required Execution
--    Fields" — this is the central operational record of the platform.
-- -----------------------------------------------------------------------------
CREATE TABLE aut_runs (
    run_pk                    BIGSERIAL PRIMARY KEY,
    run_id                        VARCHAR(64)   NOT NULL UNIQUE,     -- stable opaque external id
    automation_id                    VARCHAR(64)   NOT NULL,             -- ref: aut_automation_definitions.automation_id
    automation_version_id               VARCHAR(64)   NOT NULL,             -- ref: aut_automation_versions.automation_version_id
    environment_id                         VARCHAR(64)   NOT NULL,             -- ref: aut_environments.environment_id
    organization_id                           VARCHAR(64),                        -- opaque; no FK across schemas
    connector_id                                 VARCHAR(64),                        -- ref: aut_connectors.connector_id
    trigger_type                                    VARCHAR(32)   NOT NULL,             -- MANUAL / SCHEDULED / EVENT / API
    requested_by_ref                                   VARCHAR(64)   NOT NULL,             -- opaque operator reference, no PII
    approval_policy_id                                    VARCHAR(64),                        -- ref: aut_approval_policies.approval_policy_id
    automation_level                                         VARCHAR(32)   NOT NULL,             -- LEVEL_1_READ_ONLY .. LEVEL_4_FULL_AUTOMATIC — explicit, never inferred
    dry_run                                                    BOOLEAN       NOT NULL DEFAULT TRUE,   -- explicit, defaults safe
    correlation_id                                               VARCHAR(64),                        -- links related runs/events across systems
    idempotency_key                                                VARCHAR(128)  NOT NULL,             -- required for mutating operations; prevents duplicate side effects on retry
    resource_lock_key                                                 VARCHAR(128),                        -- ref: aut_resource_locks.resource_lock_key
    audit_event_id                                                       VARCHAR(64),                        -- ref: aut_audit_events.audit_event_id (creation event)
    snapshot_reference                                                     VARCHAR(64),                        -- ref: aut_snapshots.snapshot_id
    plan_reference                                                           VARCHAR(64),                        -- ref: aut_execution_plans.plan_id
    approval_status                                                            VARCHAR(32)   NOT NULL DEFAULT 'NOT_REQUIRED', -- NOT_REQUIRED / AWAITING_APPROVAL / APPROVED / REJECTED / EXPIRED
    approved_by_ref                                                              VARCHAR(64),                        -- opaque approver reference, no PII; must differ from requested_by_ref when separation of duties applies
    approved_at                                                                    TIMESTAMPTZ,
    rollback_plan_reference                                                          VARCHAR(64),                        -- ref: aut_rollback_plans.rollback_plan_id
    rollback_execution_reference                                                       VARCHAR(64),                        -- ref: aut_rollback_executions.rollback_execution_id
    status                                                                               VARCHAR(32)   NOT NULL DEFAULT 'QUEUED', -- see docs/AUTOMATION_ARCHITECTURE.md run-status list
    started_at                                                                             TIMESTAMPTZ,
    completed_at                                                                             TIMESTAMPTZ,
    timeout_at                                                                                 TIMESTAMPTZ,
    retry_count                                                                                  INTEGER       NOT NULL DEFAULT 0,
    max_retries                                                                                    INTEGER       NOT NULL DEFAULT 0,
    result_status                                                                                    VARCHAR(32),                        -- SUCCESS / PARTIAL_SUCCESS / FAILURE / ROLLED_BACK
    error_class                                                                                        VARCHAR(32),                        -- see docs/AUTOMATION_ARCHITECTURE.md failure classes
    error_summary                                                                                        VARCHAR(512),                       -- no secret values, no PII
    incident_id                                                                                            VARCHAR(64),                        -- ref: aut_incidents.incident_id
    source                                                                                                   VARCHAR(64)   NOT NULL,             -- originating system, e.g. 'mythos_control_center'
    created_at                                                                                                 TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    updated_at                                                                                                   TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 10. Run Steps
--     Ordered lifecycle steps within a run (DISCOVER, SNAPSHOT, ANALYSE,
--     PLAN, DRY_RUN, GATE_CHECK, APPROVAL, APPLY, VERIFY, ROLLBACK, AUDIT,
--     NOTIFY, CLOSE — see docs/AUTOMATION_ARCHITECTURE.md).
-- -----------------------------------------------------------------------------
CREATE TABLE aut_run_steps (
    run_step_pk               BIGSERIAL PRIMARY KEY,
    run_step_id                  VARCHAR(64)   NOT NULL UNIQUE,     -- stable opaque external id
    run_id                           VARCHAR(64)   NOT NULL,             -- ref: aut_runs.run_id
    step_key                            VARCHAR(32)   NOT NULL,             -- DISCOVER / SNAPSHOT / ANALYSE / PLAN / DRY_RUN / GATE_CHECK / APPROVAL / APPLY / VERIFY / ROLLBACK / AUDIT / NOTIFY / CLOSE
    step_order                             INTEGER       NOT NULL,
    status                                    VARCHAR(32)   NOT NULL DEFAULT 'QUEUED',
    started_at                                  TIMESTAMPTZ,
    completed_at                                  TIMESTAMPTZ,
    output_reference                                VARCHAR(256),                        -- URI/hash reference to step output artifact — never embedded
    error_summary                                     VARCHAR(512),
    created_at                                          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    updated_at                                            TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 11. Run Resources
--     Declares which external resources (a domain, a database, a deployment
--     target) a run touches, for lock coordination and audit scoping.
-- -----------------------------------------------------------------------------
CREATE TABLE aut_run_resources (
    run_resource_pk            BIGSERIAL PRIMARY KEY,
    run_resource_id                VARCHAR(64)   NOT NULL UNIQUE,     -- stable opaque external id
    run_id                             VARCHAR(64)   NOT NULL,             -- ref: aut_runs.run_id
    resource_type                          VARCHAR(64)   NOT NULL,             -- e.g. 'dns_zone', 'database', 'deployment_target'
    resource_external_id                       VARCHAR(256)  NOT NULL,             -- external id/name of the resource (e.g. domain name) with its source noted below
    resource_external_source                       VARCHAR(64)   NOT NULL,             -- e.g. 'ovh', 'cloudflare', 'coolify' — external IDs always stored with source
    access_mode                                       VARCHAR(16)   NOT NULL,             -- READ / WRITE
    created_at                                           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    updated_at                                             TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 12. Resource Locks
--     Prevents conflicting simultaneous operations on the same external
--     resource (e.g. two runs touching the same domain's DNS zone).
-- -----------------------------------------------------------------------------
CREATE TABLE aut_resource_locks (
    resource_lock_pk            BIGSERIAL PRIMARY KEY,
    resource_lock_key               VARCHAR(128)  NOT NULL UNIQUE,     -- stable opaque lock key, e.g. hash of resource_type+resource_external_id
    resource_type                       VARCHAR(64)   NOT NULL,
    resource_external_id                    VARCHAR(256)  NOT NULL,
    resource_external_source                    VARCHAR(64)   NOT NULL,
    held_by_run_id                                  VARCHAR(64),                        -- ref: aut_runs.run_id
    acquired_at                                       TIMESTAMPTZ,
    expires_at                                          TIMESTAMPTZ,                        -- locks must be time-bounded, never held indefinitely
    released_at                                           TIMESTAMPTZ,
    created_at                                              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    updated_at                                                TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 13. Approvals
--     Append-only approval decision history. A run's current approval_status
--     lives on aut_runs; every decision that led there is preserved here.
-- -----------------------------------------------------------------------------
CREATE TABLE aut_approvals (
    approval_pk                  BIGSERIAL PRIMARY KEY,
    approval_id                      VARCHAR(64)   NOT NULL UNIQUE,     -- stable opaque external id
    run_id                                VARCHAR(64)   NOT NULL,             -- ref: aut_runs.run_id
    approval_policy_id                       VARCHAR(64)   NOT NULL,             -- ref: aut_approval_policies.approval_policy_id
    decision                                    VARCHAR(16)   NOT NULL,             -- APPROVE / REJECT
    decided_by_ref                                 VARCHAR(64)   NOT NULL,             -- opaque approver reference, no PII
    is_self_approval                                  BOOLEAN       NOT NULL DEFAULT FALSE, -- must be FALSE when the policy forbids self-approval
    decided_at                                          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    expires_at                                            TIMESTAMPTZ,                        -- an expired approval cannot be reused by any later run
    reason                                                  VARCHAR(512),
    created_at                                                TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC — row is never updated after insert
);

-- -----------------------------------------------------------------------------
-- 14. Idempotency Keys
--     Enforces that a mutating operation, once applied, is not re-applied on
--     retry. One row per idempotency_key; a second run presenting the same
--     key observes the recorded result instead of re-executing.
-- -----------------------------------------------------------------------------
CREATE TABLE aut_idempotency_keys (
    idempotency_key_pk            BIGSERIAL PRIMARY KEY,
    idempotency_key                    VARCHAR(128)  NOT NULL UNIQUE,
    run_id                                 VARCHAR(64)   NOT NULL,             -- ref: aut_runs.run_id — the run that first claimed this key
    scope                                     VARCHAR(64)   NOT NULL,             -- e.g. connector_id or automation_id the key is scoped to
    result_status                               VARCHAR(32),                        -- recorded outcome to return on a duplicate attempt
    result_reference                              VARCHAR(256),                        -- URI/hash reference to recorded result, never embedded
    first_seen_at                                   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    expires_at                                        TIMESTAMPTZ,                        -- keys are time-bounded, not retained indefinitely
    updated_at                                          TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 15. Snapshots
--     Reference-only record of a point-in-time snapshot taken during the
--     DISCOVER/SNAPSHOT lifecycle steps (e.g. a redacted DNS zone snapshot).
--     The snapshot content itself lives outside the database; only a
--     reference and its metadata are stored here.
-- -----------------------------------------------------------------------------
CREATE TABLE aut_snapshots (
    snapshot_pk                    BIGSERIAL PRIMARY KEY,
    snapshot_id                        VARCHAR(64)   NOT NULL UNIQUE,     -- stable opaque external id
    run_id                                  VARCHAR(64),                        -- ref: aut_runs.run_id
    connector_id                                VARCHAR(64),                        -- ref: aut_connectors.connector_id
    resource_type                                   VARCHAR(64)   NOT NULL,
    resource_external_id                                VARCHAR(256)  NOT NULL,
    resource_external_source                                VARCHAR(64)   NOT NULL,
    artifact_reference                                          VARCHAR(256)  NOT NULL,             -- URI/hash reference — never embedded, never a secret
    is_redacted                                                    BOOLEAN       NOT NULL DEFAULT TRUE,   -- snapshots of provider data must be redacted before storage
    observed_at                                                      TIMESTAMPTZ   NOT NULL,             -- UTC — when the underlying data was observed
    created_at                                                         TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 16. Execution Plans
--     Reference-only record of a generated plan (LEVEL_2_RECOMMEND output or
--     LEVEL_3 pre-approval plan) — simulated impact, proposed changes,
--     generated rollback plan reference. Never itself an execution.
-- -----------------------------------------------------------------------------
CREATE TABLE aut_execution_plans (
    plan_pk                          BIGSERIAL PRIMARY KEY,
    plan_id                              VARCHAR(64)   NOT NULL UNIQUE,     -- stable opaque external id
    run_id                                    VARCHAR(64),                        -- ref: aut_runs.run_id
    automation_version_id                         VARCHAR(64)   NOT NULL,             -- ref: aut_automation_versions.automation_version_id
    plan_reference                                    VARCHAR(256)  NOT NULL,             -- URI/hash reference to the full plan artifact
    simulated_impact_summary                              VARCHAR(512),                        -- short human-readable summary, no secrets
    rollback_plan_reference                                   VARCHAR(64),                        -- ref: aut_rollback_plans.rollback_plan_id
    generated_at                                                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    created_at                                                    TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 17. Retries
--     One row per retry attempt of a run or run step. Retries are only
--     permitted for classified, safe failure classes — see
--     docs/AUTOMATION_ARCHITECTURE.md section "Failure, Retry and Rollback".
-- -----------------------------------------------------------------------------
CREATE TABLE aut_retries (
    retry_pk                          BIGSERIAL PRIMARY KEY,
    retry_id                              VARCHAR(64)   NOT NULL UNIQUE,     -- stable opaque external id
    run_id                                    VARCHAR(64)   NOT NULL,             -- ref: aut_runs.run_id
    run_step_id                                   VARCHAR(64),                        -- ref: aut_run_steps.run_step_id
    attempt_number                                   INTEGER       NOT NULL,
    failure_class                                        VARCHAR(32)   NOT NULL,             -- TRANSIENT / RATE_LIMITED / AUTHENTICATION / ... (see architecture doc)
    backoff_seconds                                        INTEGER       NOT NULL,
    idempotency_key                                            VARCHAR(128)  NOT NULL,             -- must match the original run's idempotency_key
    attempted_at                                                 TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    outcome                                                        VARCHAR(32),                        -- SUCCESS / FAILURE / EXHAUSTED
    created_at                                                       TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 18. Dead Letters
--     Runs/steps that exhausted their retry budget land here for manual
--     review. A dead-lettered item never silently disappears.
-- -----------------------------------------------------------------------------
CREATE TABLE aut_dead_letters (
    dead_letter_pk                     BIGSERIAL PRIMARY KEY,
    dead_letter_id                          VARCHAR(64)   NOT NULL UNIQUE,     -- stable opaque external id
    run_id                                        VARCHAR(64)   NOT NULL,             -- ref: aut_runs.run_id
    run_step_id                                       VARCHAR(64),                        -- ref: aut_run_steps.run_step_id
    failure_class                                         VARCHAR(32)   NOT NULL,
    error_summary                                             VARCHAR(512),                        -- no secrets, no PII
    retry_count_at_dead_letter                                    INTEGER       NOT NULL,
    incident_id                                                       VARCHAR(64),                        -- ref: aut_incidents.incident_id
    status                                                              VARCHAR(32)   NOT NULL DEFAULT 'OPEN', -- OPEN / UNDER_REVIEW / RESOLVED / DISCARDED
    resolved_at                                                           TIMESTAMPTZ,
    created_at                                                              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    updated_at                                                                TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 19. Rollback Plans
--     Reference-only record of a generated rollback plan, produced alongside
--     the forward execution plan during PLAN/DRY_RUN, before APPLY.
-- -----------------------------------------------------------------------------
CREATE TABLE aut_rollback_plans (
    rollback_plan_pk                    BIGSERIAL PRIMARY KEY,
    rollback_plan_id                         VARCHAR(64)   NOT NULL UNIQUE,     -- stable opaque external id
    run_id                                        VARCHAR(64)   NOT NULL,             -- ref: aut_runs.run_id
    plan_id                                           VARCHAR(64),                        -- ref: aut_execution_plans.plan_id (the forward plan this rolls back)
    rollback_plan_reference                               VARCHAR(256)  NOT NULL,             -- URI/hash reference to the full rollback plan artifact
    rollback_policy_key                                       VARCHAR(64),                        -- which policy governs whether rollback may run automatically
    is_automatic_eligible                                        BOOLEAN       NOT NULL DEFAULT FALSE,
    generated_at                                                    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    created_at                                                        TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 20. Rollback Executions
--     A rollback is always a separate, audited execution — never silently
--     folded into the original run's success/failure result.
-- -----------------------------------------------------------------------------
CREATE TABLE aut_rollback_executions (
    rollback_execution_pk                BIGSERIAL PRIMARY KEY,
    rollback_execution_id                     VARCHAR(64)   NOT NULL UNIQUE,     -- stable opaque external id
    rollback_plan_id                              VARCHAR(64)   NOT NULL,             -- ref: aut_rollback_plans.rollback_plan_id
    run_id                                             VARCHAR(64)   NOT NULL,             -- ref: aut_runs.run_id (the run being rolled back)
    triggered_by_ref                                       VARCHAR(64)   NOT NULL,             -- opaque operator/system reference, no PII
    trigger_reason                                            VARCHAR(32)   NOT NULL,             -- AUTOMATIC_POLICY / MANUAL / VERIFY_FAILED
    status                                                       VARCHAR(32)   NOT NULL DEFAULT 'QUEUED', -- QUEUED / ROLLING_BACK / ROLLED_BACK / FAILED
    started_at                                                     TIMESTAMPTZ,
    completed_at                                                     TIMESTAMPTZ,
    result_summary                                                     VARCHAR(512),                        -- no secrets, no PII
    incident_id                                                          VARCHAR(64),                        -- ref: aut_incidents.incident_id — a failed rollback always creates a critical incident
    created_at                                                             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    updated_at                                                               TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 21. Health Checks
--     Periodic connector/service/infrastructure health observations feeding
--     Mythos Control Center's Infrastructure Health module.
-- -----------------------------------------------------------------------------
CREATE TABLE aut_health_checks (
    health_check_pk                      BIGSERIAL PRIMARY KEY,
    health_check_id                           VARCHAR(64)   NOT NULL UNIQUE,     -- stable opaque external id
    connector_id                                  VARCHAR(64),                        -- ref: aut_connectors.connector_id
    environment_id                                    VARCHAR(64)   NOT NULL,             -- ref: aut_environments.environment_id
    check_type                                          VARCHAR(64)   NOT NULL,             -- e.g. 'connector_reachability', 'ssl_expiry', 'dns_drift'
    status                                                VARCHAR(16)   NOT NULL,             -- PASS / WARN / FAIL
    latency_ms                                              INTEGER,
    observed_at                                               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    detail_reference                                            VARCHAR(256),                        -- URI/hash reference to full check output, never embedded
    created_at                                                    TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 22. Notifications
--     Outbound operational notifications with priority and deduplication.
--     No secret or personal data may be embedded in the message body.
-- -----------------------------------------------------------------------------
CREATE TABLE aut_notifications (
    notification_pk                        BIGSERIAL PRIMARY KEY,
    notification_id                             VARCHAR(64)   NOT NULL UNIQUE,     -- stable opaque external id
    run_id                                            VARCHAR(64),                        -- ref: aut_runs.run_id
    incident_id                                           VARCHAR(64),                        -- ref: aut_incidents.incident_id
    priority                                                VARCHAR(16)   NOT NULL,             -- INFO / WARNING / HIGH / CRITICAL
    channel                                                   VARCHAR(32)   NOT NULL,             -- e.g. 'email', 'whatsapp', 'sms', 'control_center'
    dedupe_key                                                  VARCHAR(128),                        -- repeated identical alerts must dedupe on this key
    message_summary                                               VARCHAR(512)  NOT NULL,             -- redacted; no secrets, no personal data
    delivered_at                                                    TIMESTAMPTZ,
    acknowledged_at                                                   TIMESTAMPTZ,
    created_at                                                          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    updated_at                                                            TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 23. Incidents
--     Operational incidents raised by dead letters, failed rollbacks, health
--     check failures, or manual declaration.
-- -----------------------------------------------------------------------------
CREATE TABLE aut_incidents (
    incident_pk                              BIGSERIAL PRIMARY KEY,
    incident_id                                   VARCHAR(64)   NOT NULL UNIQUE,     -- stable opaque external id
    severity                                          VARCHAR(16)   NOT NULL,             -- INFO / WARNING / HIGH / CRITICAL
    source_type                                         VARCHAR(64)   NOT NULL,             -- e.g. 'dead_letter', 'rollback_failure', 'health_check', 'manual'
    source_reference                                        VARCHAR(64),                        -- id of the originating record (dead_letter_id, rollback_execution_id, etc.)
    environment_id                                            VARCHAR(64),                        -- ref: aut_environments.environment_id
    summary                                                     VARCHAR(512)  NOT NULL,             -- no secrets, no PII
    status                                                        VARCHAR(32)   NOT NULL DEFAULT 'OPEN', -- OPEN / ACKNOWLEDGED / MITIGATING / RESOLVED / CLOSED
    opened_at                                                       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    acknowledged_at                                                   TIMESTAMPTZ,
    resolved_at                                                         TIMESTAMPTZ,
    owner_ref                                                             VARCHAR(64),                        -- opaque owner reference, no PII
    created_at                                                              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    updated_at                                                                TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC
);

-- -----------------------------------------------------------------------------
-- 24. Audit Events
--     APPEND-ONLY. The permanent audit trail for every action this platform
--     ever takes or proposes. No UPDATE or DELETE path is defined for this
--     table in this or any future stage without a separate, explicit
--     governance amendment. Every other table's row-level events should be
--     mirrored here where they represent a decision or state transition.
-- -----------------------------------------------------------------------------
CREATE TABLE aut_audit_events (
    audit_event_pk                            BIGSERIAL PRIMARY KEY,
    audit_event_id                                 VARCHAR(64)   NOT NULL UNIQUE,     -- stable opaque external id
    event_type                                          VARCHAR(64)   NOT NULL,             -- e.g. 'run_created', 'approval_decided', 'connector_capability_granted'
    run_id                                                VARCHAR(64),                        -- ref: aut_runs.run_id
    connector_id                                            VARCHAR(64),                        -- ref: aut_connectors.connector_id
    environment_id                                            VARCHAR(64),                        -- ref: aut_environments.environment_id
    organization_id                                             VARCHAR(64),                        -- opaque; no FK across schemas
    actor_ref                                                     VARCHAR(64)   NOT NULL,             -- opaque actor reference (human or system), no PII
    actor_type                                                      VARCHAR(16)   NOT NULL,             -- HUMAN / SYSTEM
    event_summary                                                     VARCHAR(512)  NOT NULL,             -- no secrets, no PII
    event_detail_reference                                              VARCHAR(256),                        -- URI/hash reference to full event detail, never embedded
    occurred_at                                                           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- UTC
    created_at                                                              TIMESTAMPTZ   NOT NULL DEFAULT NOW()   -- UTC — row is never updated or deleted after insert
);

-- =============================================================================
-- End of draft schema. 24 tables defined above, matching the header count.
-- =============================================================================
