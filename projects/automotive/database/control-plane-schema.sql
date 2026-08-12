-- =============================================================================
-- Mythos Automotive — Control Plane Schema (Draft)
-- Stage:   MAE-0 / ATN-0 (13 tables added in ATN-0)
-- Date:    2026-08-05
-- Schema:  mythos_automotive (separate schema, not idauto / autovaleur / etc.)
--
-- STATUS: DRAFT — NOT DEPLOYED
-- This file documents the intended control-plane data model.
-- No migration script exists yet. No table has been created.
-- Provisioning requires explicit authorisation.
--
-- Table count: 31 (18 original MAE-0 + 13 added in ATN-0; all prefixed mythos_automotive_)
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
    checked_by_ref      VARCHAR(64),                      -- mythos_user_id — no FK across schemas
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
    activated_by_ref    VARCHAR(64),                      -- mythos_user_id
    deactivated_at      TIMESTAMPTZ,
    deactivated_by_ref  VARCHAR(64),
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
    enabled_by_ref      VARCHAR(64),                      -- mythos_user_id
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
    released_by_ref     VARCHAR(64),                      -- mythos_user_id
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
-- ATN-0 ADDITIONS — 13 new tables (18 → 31 total)
-- Added in Stage ATN-0: Atelier Network Foundation and Ecosystem Consistency Amendment
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 19. Organisations
--     Registry of platform-level organisations (links to Mythos Core entity).
--     Tracks which products each organisation subscribes to.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_automotive_organizations (
    org_id              BIGSERIAL PRIMARY KEY,
    org_ref             VARCHAR(64)   NOT NULL,           -- mythos_core.organization_id — no FK
    org_name            VARCHAR(256)  NOT NULL,
    org_type            VARCHAR(64)   NOT NULL DEFAULT 'SUBSCRIBER',
        -- SUBSCRIBER / PARTNER / PILOT / INTERNAL
    status              VARCHAR(32)   NOT NULL DEFAULT 'ACTIVE',
    onboarded_at        TIMESTAMPTZ,
    notes               TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 20. Organisation Product Entitlements
--     Which products an organisation is entitled to access.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_automotive_organization_products (
    entitlement_id      BIGSERIAL PRIMARY KEY,
    org_id              BIGINT        NOT NULL,           -- ref: mythos_automotive_organizations
    product_key         VARCHAR(64)   NOT NULL,           -- ref: mythos_automotive_products.product_key
    access_tier         VARCHAR(32)   NOT NULL DEFAULT 'professional',
    status              VARCHAR(32)   NOT NULL DEFAULT 'ACTIVE',
    activated_at        TIMESTAMPTZ,
    deactivated_at      TIMESTAMPTZ,
    notes               TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 21. Services
--     Registry of Mythos Automotive platform services and endpoints.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_automotive_services (
    service_id          BIGSERIAL PRIMARY KEY,
    service_key         VARCHAR(128)  NOT NULL UNIQUE,    -- e.g. 'idauto.vehicle-lookup'
    product_key         VARCHAR(64)   NOT NULL,
    service_name        VARCHAR(256)  NOT NULL,
    service_type        VARCHAR(32)   NOT NULL,           -- API / EVENT_PRODUCER / BATCH / INTEGRATION
    access_scope        VARCHAR(32)   NOT NULL DEFAULT 'professional',
    status              VARCHAR(32)   NOT NULL DEFAULT 'DESIGNED',
        -- DESIGNED / SPECIFIED / ACTIVE / DEPRECATED
    activation_stage    VARCHAR(32),
    is_public           BOOLEAN       NOT NULL DEFAULT FALSE,
    legal_review_required BOOLEAN     NOT NULL DEFAULT FALSE,
    notes               TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 22. Endpoints
--     Registry of API endpoints per service.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_automotive_endpoints (
    endpoint_id         BIGSERIAL PRIMARY KEY,
    service_id          BIGINT        NOT NULL,           -- ref: mythos_automotive_services
    method              VARCHAR(8)    NOT NULL,           -- GET / POST / PUT / DELETE
    path                VARCHAR(512)  NOT NULL,
    description         TEXT,
    access_scope        VARCHAR(32)   NOT NULL DEFAULT 'professional',
    rate_limited        BOOLEAN       NOT NULL DEFAULT TRUE,
    audit_required      BOOLEAN       NOT NULL DEFAULT FALSE,
    is_active           BOOLEAN       NOT NULL DEFAULT FALSE,
    activation_stage    VARCHAR(32),
    notes               TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 23. Service Accounts
--     Registry of machine-to-machine service accounts across the ecosystem.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_automotive_service_accounts (
    account_id          BIGSERIAL PRIMARY KEY,
    account_key         VARCHAR(128)  NOT NULL UNIQUE,
    product_key         VARCHAR(64)   NOT NULL,
    description         TEXT,
    scopes              TEXT[],                           -- permitted access scopes
    is_active           BOOLEAN       NOT NULL DEFAULT FALSE,
    rotated_at          TIMESTAMPTZ,
    rotation_due_at     DATE,
    notes               TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 24. Data Sources
--     Registry of all external data sources across the ecosystem.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_automotive_data_sources (
    source_id           BIGSERIAL PRIMARY KEY,
    source_key          VARCHAR(128)  NOT NULL UNIQUE,
    source_name         VARCHAR(256)  NOT NULL,
    source_type         VARCHAR(64)   NOT NULL,
        -- marketplace / parts_platform / official_registry / workshop / internal / other
    product_key         VARCHAR(64),                      -- primary consumer
    trust_level         SMALLINT      NOT NULL DEFAULT 1 CHECK (trust_level BETWEEN 1 AND 5),
    legal_status        VARCHAR(64)   NOT NULL DEFAULT 'LEGAL-REVIEW-REQUIRED',
        -- LEGAL-REVIEW-REQUIRED / APPROVED / ACTIVE / REVOKED
    is_active           BOOLEAN       NOT NULL DEFAULT FALSE,
    legal_review_date   DATE,
    contract_ref        VARCHAR(256),
    notes               TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 25. Dependencies
--     Registry of cross-product technical dependencies.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_automotive_dependencies (
    dependency_id       BIGSERIAL PRIMARY KEY,
    dependent_product   VARCHAR(64)   NOT NULL,           -- product that needs the dependency
    required_product    VARCHAR(64)   NOT NULL,           -- product providing what is needed
    dependency_type     VARCHAR(64)   NOT NULL,
        -- POSTGRESQL_CLUSTER / API_ENDPOINT / EVENT / SCHEMA / LEGAL / AUTH
    description         TEXT          NOT NULL,
    required_stage      VARCHAR(32),                      -- stage at which dependency becomes active
    status              VARCHAR(32)   NOT NULL DEFAULT 'PENDING',
        -- PENDING / AVAILABLE / DEPRECATED
    notes               TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 26. Partner Onboarding
--     Tracks onboarding status for external partner organisations.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_automotive_partner_onboarding (
    onboarding_id       BIGSERIAL PRIMARY KEY,
    org_id              BIGINT        NOT NULL,           -- ref: mythos_automotive_organizations
    product_key         VARCHAR(64)   NOT NULL,
    partner_type        VARCHAR(64)   NOT NULL,
        -- WORKSHOP / PARTS_SUPPLIER / MARKETPLACE / INSPECTION_PROVIDER / DATA_SOURCE
    status              VARCHAR(32)   NOT NULL DEFAULT 'PENDING',
        -- PENDING / IN_PROGRESS / COMPLETED / REJECTED / SUSPENDED
    legal_agreement_ref VARCHAR(256),
    legal_review_completed BOOLEAN    NOT NULL DEFAULT FALSE,
    technical_review_completed BOOLEAN NOT NULL DEFAULT FALSE,
    onboarded_at        TIMESTAMPTZ,
    notes               TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 27. Service Providers
--     Registry of external service providers (workshops, inspectors, etc.)
--     at the ecosystem governance level.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_automotive_service_providers (
    provider_id         BIGSERIAL PRIMARY KEY,
    org_id              BIGINT        NOT NULL,           -- ref: mythos_automotive_organizations
    provider_type       VARCHAR(64)   NOT NULL,
        -- WORKSHOP / INSPECTION_PROVIDER / PARTS_SUPPLIER / MARKETPLACE
    provider_name       VARCHAR(256)  NOT NULL,
    product_key         VARCHAR(64)   NOT NULL,           -- primary product governing this provider
    status              VARCHAR(32)   NOT NULL DEFAULT 'PENDING',
    legal_review_completed BOOLEAN    NOT NULL DEFAULT FALSE,
    notes               TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 28. Provider Sites
--     Physical sites or locations for service providers.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_automotive_provider_sites (
    site_id             BIGSERIAL PRIMARY KEY,
    provider_id         BIGINT        NOT NULL,           -- ref: mythos_automotive_service_providers
    site_name           VARCHAR(256)  NOT NULL,
    governorate         VARCHAR(64),
    is_primary_site     BOOLEAN       NOT NULL DEFAULT TRUE,
    status              VARCHAR(32)   NOT NULL DEFAULT 'ACTIVE',
    notes               TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 29. Provider Capabilities
--     Capabilities (service categories) per provider site.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_automotive_provider_capabilities (
    capability_id       BIGSERIAL PRIMARY KEY,
    provider_id         BIGINT        NOT NULL,           -- ref: mythos_automotive_service_providers
    capability_type     VARCHAR(64)   NOT NULL,
        -- AUTOCHECK_INSPECTION / SMART_GATE / ENGINE / BRAKES / HYBRID_EV / GENERAL_REPAIR / etc.
    is_accredited       BOOLEAN       NOT NULL DEFAULT FALSE,
    accreditation_ref   BIGINT,                           -- ref: mythos_automotive_provider_accreditations
    notes               TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 30. Provider Accreditations
--     Formal accreditations held by service providers.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_automotive_provider_accreditations (
    accreditation_id    BIGSERIAL PRIMARY KEY,
    provider_id         BIGINT        NOT NULL,           -- ref: mythos_automotive_service_providers
    accreditation_type  VARCHAR(64)   NOT NULL,
        -- AUTOCHECK_PROVIDER / SMART_GATE_APPROVED / MANUFACTURER_CERTIFIED /
        -- GOVERNMENT_INSPECTION / INSURANCE_APPROVED
    issuing_body        VARCHAR(256),
    certificate_ref     VARCHAR(256),
    issued_at           DATE,
    expires_at          DATE,
    status              VARCHAR(32)   NOT NULL DEFAULT 'ACTIVE',
        -- ACTIVE / EXPIRED / SUSPENDED / REVOKED
    notes               TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 31. Audit Events (Control Plane)
--     Ecosystem-level audit events across the control plane.
--     Separate from product-level audit tables.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_automotive_audit_events (
    audit_id            BIGSERIAL PRIMARY KEY,
    event_id            UUID          NOT NULL,           -- cross-product correlation UUID v4
    event_name          VARCHAR(256)  NOT NULL,
    actor_ref           VARCHAR(64),                      -- mythos_user_id — no FK
    actor_role          VARCHAR(64),
    product_key         VARCHAR(64),
    target_table        VARCHAR(128),
    target_id           BIGINT,
    action              VARCHAR(32)   NOT NULL,           -- CREATE / READ / UPDATE / DELETE / AUDIT_WRITE
    access_scope        VARCHAR(32)   NOT NULL,
    privacy_class       VARCHAR(64),
    event_metadata      JSONB,                            -- no PII
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
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
    ('mythos_user_id',   'mythos_core', 'mythos_core', 'VARCHAR(64)', TRUE,  TRUE,  'Platform identity'),
    ('organization_id',  'mythos_core', 'mythos_core', 'VARCHAR(64)', TRUE,  TRUE,  'Subscriber organisation'),
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
-- Seed: Additional canonical identifiers (ATN-0 additions — Atelier Network)
-- =============================================================================
INSERT INTO mythos_automotive_canonical_identifiers
    (id_key, owner_product, owner_schema, data_type, is_primary_key, is_cross_product, description)
VALUES
    ('workshop_organization_id', 'atelier_network', 'atelier_network', 'BIGSERIAL', TRUE,  FALSE, 'Workshop organisation — top level of multi-tenant hierarchy'),
    ('workshop_id',              'atelier_network', 'atelier_network', 'BIGSERIAL', TRUE,  FALSE, 'Individual workshop brand or location'),
    ('workshop_site_id',         'atelier_network', 'atelier_network', 'BIGSERIAL', TRUE,  FALSE, 'Physical site or branch (branch_id is alias when site_type = BRANCH)'),
    ('workshop_capability_id',   'atelier_network', 'atelier_network', 'BIGSERIAL', TRUE,  FALSE, 'Workshop service capability record'),
    ('workshop_accreditation_id','atelier_network', 'atelier_network', 'BIGSERIAL', TRUE,  FALSE, 'Workshop formal accreditation'),
    ('technician_assignment_id', 'atelier_network', 'atelier_network', 'BIGSERIAL', TRUE,  FALSE, 'Technician-to-site assignment'),
    ('service_catalog_item_id',  'atelier_network', 'atelier_network', 'BIGSERIAL', TRUE,  FALSE, 'Service catalogue item per workshop'),
    ('appointment_id',           'atelier_network', 'atelier_network', 'BIGSERIAL', TRUE,  FALSE, 'Appointment booking'),
    ('inspection_id',            'atelier_network', 'atelier_network', 'BIGSERIAL', TRUE,  FALSE, 'Inspection event'),
    ('inspection_provider_id',   'atelier_network', 'atelier_network', 'BIGSERIAL', TRUE,  TRUE,  'Accredited AutoCheck provider — cross-product: AutoValeur reference'),
    ('work_order_id',            'atelier_network', 'atelier_network', 'BIGSERIAL', TRUE,  FALSE, 'Work order'),
    ('intervention_id',          'atelier_network', 'atelier_network', 'BIGSERIAL', TRUE,  FALSE, 'Repair/maintenance intervention'),
    ('repair_estimate_id',       'atelier_network', 'atelier_network', 'BIGSERIAL', TRUE,  TRUE,  'Repair estimate — cross-product: AutoValeur reads this'),
    ('external_workshop_record_id','atelier_network','atelier_network','BIGSERIAL', TRUE,  FALSE, 'Normalised record from EXTERNAL_CONNECTED workshop');

-- =============================================================================
-- End of control-plane-schema.sql
-- Table count: 31 (18 original MAE-0 + 13 added in ATN-0)
-- Status: DRAFT — NOT DEPLOYED
-- =============================================================================
