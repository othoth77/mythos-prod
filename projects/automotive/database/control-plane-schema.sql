-- =============================================================================
-- Mythos Automotive — Control Plane Schema (Draft)
-- Stage:   MAE-0 Ecosystem Master Foundation
-- Date:    2026-08-05
-- Schema:  mythos_automotive (separate schema, not idauto / autovaleur / etc.)
--
-- STATUS: DRAFT — NOT DEPLOYED
-- This file documents the intended control-plane data model.
-- No migration script exists yet. No table has been created.
-- Provisioning requires explicit authorisation.
--
-- Table count: 18 (all prefixed mythos_automotive_)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Products
--    Registry of all Mythos Automotive portfolio products.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_automotive_products (
    product_id          BIGSERIAL PRIMARY KEY,
    product_key         VARCHAR(64)   NOT NULL UNIQUE,    -- e.g. 'idauto', 'autovaleur'
    display_name        VARCHAR(128)  NOT NULL,
    status              VARCHAR(32)   NOT NULL,           -- CONCEPT / FOUNDATION / SPECIFIED / BUILD / PILOT / BETA / PRODUCTION / PAUSED / RETIRED
    current_stage       VARCHAR(64),                      -- e.g. 'IDA-2'
    schema_name         VARCHAR(64),                      -- PostgreSQL schema this product owns
    is_external         BOOLEAN       NOT NULL DEFAULT FALSE,
    is_runtime_active   BOOLEAN       NOT NULL DEFAULT FALSE,
    notes               TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 2. Product Stages
--    Log of stages (planned, started, completed) per product.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_automotive_product_stages (
    stage_id            BIGSERIAL PRIMARY KEY,
    product_id          BIGINT        NOT NULL,           -- ref: mythos_automotive_products
    stage_key           VARCHAR(32)   NOT NULL UNIQUE,    -- e.g. 'IDA-2', 'AVA-1'
    stage_name          VARCHAR(256)  NOT NULL,
    stage_type          VARCHAR(32)   NOT NULL,           -- DOCUMENTATION / IMPLEMENTATION / GOVERNANCE
    status              VARCHAR(32)   NOT NULL DEFAULT 'NOT_STARTED',
    blocked_on          VARCHAR(128),                     -- stage_key of blocking stage
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    implementation_commit_sha VARCHAR(64),
    notes               TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 3. Stage Gates
--    Gate check records for Foundation / Build / Pilot / Production gates.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_automotive_stage_gates (
    gate_id             BIGSERIAL PRIMARY KEY,
    stage_id            BIGINT        NOT NULL,           -- ref: mythos_automotive_product_stages
    gate_type           VARCHAR(32)   NOT NULL,           -- FOUNDATION / BUILD / PILOT / PRODUCTION
    checklist_item      VARCHAR(512)  NOT NULL,
    status              VARCHAR(32)   NOT NULL DEFAULT 'PENDING',  -- PENDING / PASS / FAIL / WAIVED
    checked_at          TIMESTAMPTZ,
    checked_by_ref      BIGINT,                           -- mythos_user_id — no FK across schemas
    notes               TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 4. Architecture Decisions
--    Registry of Master Architecture Decisions (MAD-*) and product-level ADs.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_automotive_architecture_decisions (
    ad_id               BIGSERIAL PRIMARY KEY,
    ad_key              VARCHAR(32)   NOT NULL UNIQUE,    -- e.g. 'MAD-1', 'AD-A4'
    scope               VARCHAR(32)   NOT NULL,           -- ECOSYSTEM / IDAUTO / AUTOVALEUR / ...
    title               VARCHAR(512)  NOT NULL,
    decision_text       TEXT          NOT NULL,
    rationale           TEXT,
    consequences        TEXT,
    status              VARCHAR(32)   NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE / SUPERSEDED / DEPRECATED
    superseded_by       VARCHAR(32),                      -- ad_key of replacement
    source_document     VARCHAR(256),
    effective_stage     VARCHAR(32),
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 5. Integration Contracts
--    Registry of all cross-product integration contracts, versioned.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_automotive_integration_contracts (
    contract_id         BIGSERIAL PRIMARY KEY,
    contract_key        VARCHAR(128)  NOT NULL,           -- e.g. 'idauto-to-autovaleur-vehicle-lookup'
    contract_version    VARCHAR(32)   NOT NULL,
    producer_product    VARCHAR(64)   NOT NULL,
    consumer_product    VARCHAR(64)   NOT NULL,
    integration_type    VARCHAR(32)   NOT NULL,           -- SYNC_API / ASYNC_EVENT / READ_MODEL
    data_description    TEXT          NOT NULL,
    activation_stage    VARCHAR(32),
    status              VARCHAR(32)   NOT NULL DEFAULT 'DEFINED',  -- DEFINED / ACTIVE / DEPRECATED
    source_document     VARCHAR(256),
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE (contract_key, contract_version)
);

-- -----------------------------------------------------------------------------
-- 6. Integration Activations
--    Records when a contract was activated (enabled) and by whom.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_automotive_integration_activations (
    activation_id       BIGSERIAL PRIMARY KEY,
    contract_id         BIGINT        NOT NULL,           -- ref: mythos_automotive_integration_contracts
    activated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    activated_by_ref    BIGINT,                           -- mythos_user_id
    deactivated_at      TIMESTAMPTZ,
    deactivated_by_ref  BIGINT,
    authorisation_ref   VARCHAR(256),                     -- reference to authorisation record
    notes               TEXT
);

-- -----------------------------------------------------------------------------
-- 7. Legal Requirements
--    Central registry of all LEGAL-REVIEW-REQUIRED items across all products.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_automotive_legal_requirements (
    legal_req_id        BIGSERIAL PRIMARY KEY,
    requirement_key     VARCHAR(32)   NOT NULL UNIQUE,    -- e.g. 'R-L01'
    product_key         VARCHAR(64)   NOT NULL,           -- or 'All'
    description         TEXT          NOT NULL,
    legal_category      VARCHAR(128),                     -- e.g. 'Data protection', 'Regulatory approval'
    blocking_stage      VARCHAR(64),
    status              VARCHAR(32)   NOT NULL DEFAULT 'OPEN',  -- OPEN / IN_REVIEW / RESOLVED / WAIVED
    legal_counsel_ref   VARCHAR(256),
    resolution_date     DATE,
    impacted_products   TEXT[],
    resolution_notes    TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 8. Risk Register
--    Tracks ecosystem and product risks with mitigation status.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_automotive_risk_register (
    risk_id             BIGSERIAL PRIMARY KEY,
    risk_key            VARCHAR(32)   NOT NULL UNIQUE,    -- e.g. 'R-T01'
    risk_category       VARCHAR(32)   NOT NULL,           -- LEGAL / DATA / TECHNICAL / OPERATIONAL / BUSINESS / PRIVACY
    domain              VARCHAR(128)  NOT NULL,
    description         TEXT          NOT NULL,
    likelihood          CHAR(1)       NOT NULL CHECK (likelihood IN ('H', 'M', 'L')),
    impact              CHAR(1)       NOT NULL CHECK (impact IN ('H', 'M', 'L')),
    mitigation          TEXT,
    blocking_stage      VARCHAR(64),
    status              VARCHAR(32)   NOT NULL DEFAULT 'OPEN',  -- OPEN / MITIGATED / ACCEPTED / CLOSED
    owner_ref           VARCHAR(128),
    last_reviewed_at    TIMESTAMPTZ,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 9. KPI Definitions
--    Registry of all defined KPIs with formula and data source.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_automotive_kpi_definitions (
    kpi_id              BIGSERIAL PRIMARY KEY,
    kpi_key             VARCHAR(128)  NOT NULL UNIQUE,    -- e.g. 'idauto.verified_fiches'
    product_key         VARCHAR(64)   NOT NULL,           -- or 'portfolio'
    category            VARCHAR(128),                     -- e.g. 'Data quality'
    display_name        VARCHAR(256)  NOT NULL,
    formula             TEXT          NOT NULL,
    data_source         TEXT,
    access_scope        VARCHAR(32)   NOT NULL DEFAULT 'professional',
    version             INTEGER       NOT NULL DEFAULT 1,
    effective_from      DATE          NOT NULL DEFAULT CURRENT_DATE,
    superseded_at       DATE,
    notes               TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 10. KPI Snapshots
--     Periodic recorded values for defined KPIs.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_automotive_kpi_snapshots (
    snapshot_id         BIGSERIAL PRIMARY KEY,
    kpi_id              BIGINT        NOT NULL,           -- ref: mythos_automotive_kpi_definitions
    snapshot_date       DATE          NOT NULL,
    period_type         VARCHAR(32)   NOT NULL DEFAULT 'monthly',  -- daily / weekly / monthly
    numeric_value       NUMERIC(18, 4),
    text_value          VARCHAR(512),
    unit                VARCHAR(64),
    segment             VARCHAR(128),                     -- optional breakdown (e.g. governorate)
    computed_by         VARCHAR(128),
    notes               TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE (kpi_id, snapshot_date, period_type, segment)
);

-- -----------------------------------------------------------------------------
-- 11. Feature Flags
--     Ecosystem-level feature flag registry and current state.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_automotive_feature_flags (
    flag_id             BIGSERIAL PRIMARY KEY,
    flag_key            VARCHAR(128)  NOT NULL UNIQUE,
    product_key         VARCHAR(64)   NOT NULL,
    description         TEXT,
    enabled             BOOLEAN       NOT NULL DEFAULT FALSE,
    enabled_for_scopes  TEXT[],                           -- access scopes in which flag is active
    enabled_at          TIMESTAMPTZ,
    enabled_by_ref      BIGINT,                           -- mythos_user_id
    activation_stage    VARCHAR(32),
    legal_review_required BOOLEAN     NOT NULL DEFAULT FALSE,
    notes               TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 12. Access Scope Definitions
--     Canonical registry of access scopes used across the ecosystem.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_automotive_access_scope_definitions (
    scope_id            BIGSERIAL PRIMARY KEY,
    scope_key           VARCHAR(64)   NOT NULL UNIQUE,    -- e.g. 'public', 'mythos_private'
    display_name        VARCHAR(128)  NOT NULL,
    description         TEXT          NOT NULL,
    who_accesses        TEXT          NOT NULL,
    audit_required      BOOLEAN       NOT NULL DEFAULT FALSE,
    examples            TEXT[],
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 13. Canonical Identifiers
--     Registry of all canonical IDs across the ecosystem.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_automotive_canonical_identifiers (
    identifier_id       BIGSERIAL PRIMARY KEY,
    id_key              VARCHAR(64)   NOT NULL UNIQUE,    -- e.g. 'vehicle_id'
    owner_product       VARCHAR(64)   NOT NULL,
    owner_schema        VARCHAR(64)   NOT NULL,
    data_type           VARCHAR(64)   NOT NULL,           -- e.g. 'BIGSERIAL', 'UUID'
    description         TEXT,
    is_primary_key      BOOLEAN       NOT NULL DEFAULT TRUE,
    is_cross_product    BOOLEAN       NOT NULL DEFAULT FALSE,
    notes               TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 14. Environments
--     Registry of deployment environments.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_automotive_environments (
    environment_id      BIGSERIAL PRIMARY KEY,
    environment_key     VARCHAR(64)   NOT NULL UNIQUE,    -- e.g. 'production', 'staging', 'development'
    display_name        VARCHAR(128)  NOT NULL,
    host                VARCHAR(256),
    is_production       BOOLEAN       NOT NULL DEFAULT FALSE,
    shares_resources_with VARCHAR(64),                   -- environment_key if shared resources (risk flag)
    status              VARCHAR(32)   NOT NULL DEFAULT 'DEFINED',
    notes               TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 15. Releases
--     Registry of production releases per product.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_automotive_releases (
    release_id          BIGSERIAL PRIMARY KEY,
    product_key         VARCHAR(64)   NOT NULL,
    stage_key           VARCHAR(32),
    version_tag         VARCHAR(64)   NOT NULL,
    commit_sha          VARCHAR(64),
    environment_key     VARCHAR(64)   NOT NULL,
    released_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    released_by_ref     BIGINT,                           -- mythos_user_id
    release_notes       TEXT,
    rollback_sha        VARCHAR(64),
    status              VARCHAR(32)   NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE / ROLLED_BACK / SUPERSEDED
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 16. Incidents
--     Registry of production incidents across all products.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_automotive_incidents (
    incident_id         BIGSERIAL PRIMARY KEY,
    product_key         VARCHAR(64),                      -- NULL for cross-product incidents
    severity            CHAR(2)       NOT NULL CHECK (severity IN ('P1', 'P2', 'P3', 'P4')),
    title               VARCHAR(512)  NOT NULL,
    description         TEXT,
    detected_at         TIMESTAMPTZ   NOT NULL,
    acknowledged_at     TIMESTAMPTZ,
    resolved_at         TIMESTAMPTZ,
    root_cause          TEXT,
    pii_involved        BOOLEAN       NOT NULL DEFAULT FALSE,
    data_loss           BOOLEAN       NOT NULL DEFAULT FALSE,
    post_mortem_required BOOLEAN      NOT NULL DEFAULT FALSE,
    post_mortem_completed_at TIMESTAMPTZ,
    status              VARCHAR(32)   NOT NULL DEFAULT 'OPEN',  -- OPEN / ACKNOWLEDGED / RESOLVED / CLOSED
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 17. Backup Status
--     Registry of backup runs and restore test results.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_automotive_backup_status (
    backup_id           BIGSERIAL PRIMARY KEY,
    product_key         VARCHAR(64)   NOT NULL,
    environment_key     VARCHAR(64)   NOT NULL,
    backup_type         VARCHAR(32)   NOT NULL,           -- POSTGRESQL_FULL / POSTGRESQL_WAL / OBJECT_STORAGE / APPLICATION
    backup_target       VARCHAR(512)  NOT NULL,           -- location (outside VPS)
    backup_started_at   TIMESTAMPTZ   NOT NULL,
    backup_completed_at TIMESTAMPTZ,
    backup_size_bytes   BIGINT,
    encrypted           BOOLEAN       NOT NULL DEFAULT TRUE,
    restore_tested      BOOLEAN       NOT NULL DEFAULT FALSE,
    restore_tested_at   TIMESTAMPTZ,
    restore_success     BOOLEAN,
    restore_notes       TEXT,
    status              VARCHAR(32)   NOT NULL DEFAULT 'PENDING',  -- PENDING / SUCCESS / FAILED
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 18. Domain Events Catalogue
--     Design-time catalogue of all planned domain events across the ecosystem.
--     No event bus exists in MAE-0.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_automotive_domain_events (
    event_catalogue_id  BIGSERIAL PRIMARY KEY,
    event_name          VARCHAR(256)  NOT NULL UNIQUE,    -- e.g. 'vehicle.fact.verified'
    producer_product    VARCHAR(64)   NOT NULL,
    access_scope        VARCHAR(64)   NOT NULL,           -- privacy classification of event payload
    description         TEXT,
    payload_schema      JSONB,                            -- draft payload structure (no enforcement)
    permitted_consumers TEXT[],
    activation_stage    VARCHAR(32),
    status              VARCHAR(32)   NOT NULL DEFAULT 'DESIGNED',  -- DESIGNED / SPECIFIED / ACTIVE / DEPRECATED
    notes               TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- Seed: Access scope definitions (canonical — matches AUTOMOTIVE_ARCHITECTURE.md)
-- =============================================================================
INSERT INTO mythos_automotive_access_scope_definitions
    (scope_key, display_name, description, who_accesses, audit_required, examples)
VALUES
    ('public',             'Public',               'Any caller within rate limits',         'Anonymous or authenticated callers', FALSE, ARRAY['plate_number','colour','make','model','year','governorate']),
    ('professional',       'Professional',         'Verified subscriber organisations',     'Verified professional subscribers',  FALSE, ARRAY['technical_facts','service_history_count','repair_estimate']),
    ('mythos_private',     'Mythos Private',       'Mythos Super Admin only — audit logged','Mythos Super Admin',                 TRUE,  ARRAY['raw_captures','exact_gps','exact_timestamps','deal_pipeline','camera_source']),
    ('product_internal',   'Product Internal',     'Owning product API only',               'Owning product services',            FALSE, ARRAY['internal_processing_state','queue_items']),
    ('organization_private','Organisation Private','One organisation',                       'Members of the owning organisation', FALSE, ARRAY['fixpert_invoice','customer_fiche']),
    ('consent_shared',     'Consent Shared',       'Subject-consented cross-product access','Specific product with explicit consent',FALSE,ARRAY['customer_pii_shared_with_consent']);

-- =============================================================================
-- Seed: Canonical identifier registry (matches AUTOMOTIVE_DATA_GOVERNANCE.md)
-- =============================================================================
INSERT INTO mythos_automotive_canonical_identifiers
    (id_key, owner_product, owner_schema, data_type, is_primary_key, is_cross_product, description)
VALUES
    ('vehicle_id',       'idauto',      'idauto',      'BIGSERIAL', TRUE,  TRUE,  'Central ecosystem key — every product references this'),
    ('plate_id',         'idauto',      'idauto',      'BIGSERIAL', TRUE,  FALSE, 'Plate identity record'),
    ('observation_id',   'idauto',      'idauto',      'BIGSERIAL', TRUE,  FALSE, 'Immutable observation'),
    ('fact_id',          'idauto',      'idauto',      'BIGSERIAL', TRUE,  FALSE, 'Versioned vehicle fact'),
    ('document_scan_id', 'idauto',      'idauto',      'BIGSERIAL', TRUE,  FALSE, 'Carte grise scan — no PII stored'),
    ('mythos_user_id',   'mythos_core', 'mythos_core', 'BIGSERIAL', TRUE,  TRUE,  'Platform identity'),
    ('organization_id',  'mythos_core', 'mythos_core', 'BIGSERIAL', TRUE,  TRUE,  'Subscriber organisation'),
    ('valuation_id',     'autovaleur',  'autovaleur',  'BIGSERIAL', TRUE,  FALSE, 'Immutable valuation record'),
    ('listing_id',       'automarket',  'automarket',  'BIGSERIAL', TRUE,  FALSE, 'Future — AutoMarket listing'),
    ('offer_id',         'automarket',  'automarket',  'BIGSERIAL', TRUE,  FALSE, 'Future — AutoMarket offer'),
    ('transaction_id',   'automarket',  'automarket',  'BIGSERIAL', TRUE,  FALSE, 'Future — AutoMarket completed sale'),
    ('fleet_id',         'fleet',       'fleet',       'BIGSERIAL', TRUE,  FALSE, 'Future — Fleet Pro fleet'),
    ('assistance_case_id','assistance', 'assistance',  'BIGSERIAL', TRUE,  FALSE, 'Future — Fixpert Assistance case'),
    ('document_id',      'mythos_core', 'mythos_core', 'BIGSERIAL', TRUE,  FALSE, 'Object storage reference'),
    ('media_id',         'mythos_core', 'mythos_core', 'BIGSERIAL', TRUE,  FALSE, 'Object storage media reference'),
    ('event_id',         'per_product', 'per_product', 'UUID',      FALSE, TRUE,  'Cross-product correlation ID — UUID v4');

-- =============================================================================
-- End of control-plane-schema.sql
-- Table count: 18
-- Status: DRAFT — NOT DEPLOYED
-- =============================================================================
