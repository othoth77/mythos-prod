-- =============================================================================
-- Mythos Atelier Network — Database Schema Draft
-- Stage:   ATN-0 Atelier Network Foundation
-- Date:    2026-08-05
-- Schema:  atelier_network (separate schema, not idauto / autovaleur / etc.)
--
-- STATUS: DRAFT — NOT DEPLOYED
-- This file documents the intended data model for the Atelier Network platform.
-- No migration script exists yet. No table has been created.
-- Provisioning requires explicit authorisation in ATN-1 or later.
--
-- Ownership boundaries:
--   vehicle_id belongs exclusively to idauto schema (ID Auto)
--   mythos_user_id / organization_id belong to mythos_core schema
--   workshop operational data (appointments, work orders, invoices, customer PII)
--     is owned by each workshop organisation within its organisation_private boundary
--   Atelier Network owns: platform registry, network governance, integration connectors,
--     inspection standards, audit events
--   Smart Gate observations produced by Smart Gate devices go to ID Auto (not this schema)
--
-- Multi-tenant hierarchy:
--   workshop_organization_id → workshop_id → workshop_site_id → operational records
--
-- Privacy: No PII columns in this schema except in atn_customer_consents
--   (consent record — not PII duplication). Operational customer data belongs
--   to each organisation's own tables, not to the shared platform schema.
--
-- Table count: 24 (all prefixed atn_)
-- =============================================================================


-- =============================================================================
-- PART 1 — NETWORK REGISTRY
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Workshop Organisations
--    Top level of the multi-tenant hierarchy. Each org owns its own data.
-- -----------------------------------------------------------------------------
CREATE TABLE atn_workshop_organizations (
    workshop_organization_id    BIGSERIAL PRIMARY KEY,
    organization_ref            BIGINT          NOT NULL,   -- mythos_core.organization_id — no FK across schemas
    org_name                    VARCHAR(256)    NOT NULL,
    legal_entity_name           VARCHAR(256),
    country                     CHAR(2)         NOT NULL DEFAULT 'TN',
    registration_number         VARCHAR(128),
    contact_email               VARCHAR(256),               -- operational contact, not customer PII
    contact_phone               VARCHAR(32),
    network_tier                VARCHAR(32)     NOT NULL DEFAULT 'PARTNER',
        -- OWNED / FRANCHISE / PARTNER / AUTHORIZED_INSPECTION
    status                      VARCHAR(32)     NOT NULL DEFAULT 'PENDING',
        -- PENDING / ACTIVE / SUSPENDED / TERMINATED
    onboarded_at                TIMESTAMPTZ,
    suspended_at                TIMESTAMPTZ,
    terminated_at               TIMESTAMPTZ,
    notes                       TEXT,
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 2. Workshops
--    Individual workshops belonging to an organisation.
--    An organisation may operate multiple workshops (brands, locations).
-- -----------------------------------------------------------------------------
CREATE TABLE atn_workshops (
    workshop_id                 BIGSERIAL PRIMARY KEY,
    workshop_organization_id    BIGINT          NOT NULL,   -- ref: atn_workshop_organizations
    workshop_name               VARCHAR(256)    NOT NULL,
    workshop_type               VARCHAR(64)     NOT NULL,
        -- OWNED / BRANCH / FRANCHISE / PARTNER / AUTHORIZED_INSPECTION / MOBILE_SERVICE
    integration_mode            VARCHAR(32)     NOT NULL DEFAULT 'EXTERNAL_CONNECTED',
        -- NATIVE_MANAGED / EXTERNAL_CONNECTED / HYBRID
    is_autocheck_provider       BOOLEAN         NOT NULL DEFAULT FALSE,
    is_smart_gate_equipped      BOOLEAN         NOT NULL DEFAULT FALSE,
    status                      VARCHAR(32)     NOT NULL DEFAULT 'PENDING',
        -- PENDING / ACTIVE / SUSPENDED / INACTIVE
    primary_governorate         VARCHAR(64),
    latitude                    NUMERIC(9, 6),              -- no PII; location is physical workshop coords
    longitude                   NUMERIC(9, 6),
    notes                       TEXT,
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 3. Workshop Sites
--    Physical sites or branches within a workshop. A simple single-site
--    workshop has one site. A multi-site chain has multiple.
-- -----------------------------------------------------------------------------
CREATE TABLE atn_workshop_sites (
    workshop_site_id            BIGSERIAL PRIMARY KEY,
    workshop_id                 BIGINT          NOT NULL,   -- ref: atn_workshops
    site_name                   VARCHAR(256)    NOT NULL,
    site_type                   VARCHAR(32)     NOT NULL DEFAULT 'MAIN',
        -- MAIN / BRANCH / ANNEX / MOBILE_UNIT
    address_line1               VARCHAR(256),
    address_line2               VARCHAR(256),
    governorate                 VARCHAR(64),
    postal_code                 VARCHAR(16),
    country                     CHAR(2)         NOT NULL DEFAULT 'TN',
    latitude                    NUMERIC(9, 6),
    longitude                   NUMERIC(9, 6),
    status                      VARCHAR(32)     NOT NULL DEFAULT 'ACTIVE',
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 4. Network Memberships
--    Tracks when and how each organisation joined the network.
-- -----------------------------------------------------------------------------
CREATE TABLE atn_network_memberships (
    membership_id               BIGSERIAL PRIMARY KEY,
    workshop_organization_id    BIGINT          NOT NULL,   -- ref: atn_workshop_organizations
    membership_type             VARCHAR(64)     NOT NULL,
        -- FULL / INSPECTION_ONLY / API_CONSUMER
    started_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    ended_at                    TIMESTAMPTZ,
    agreement_ref               VARCHAR(256),               -- reference to external contract document
    legal_review_completed      BOOLEAN         NOT NULL DEFAULT FALSE,
    notes                       TEXT,
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- PART 2 — CAPABILITIES AND ACCREDITATIONS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 5. Workshop Capabilities
--    What service categories a workshop is certified or equipped to perform.
-- -----------------------------------------------------------------------------
CREATE TABLE atn_workshop_capabilities (
    workshop_capability_id      BIGSERIAL PRIMARY KEY,
    workshop_id                 BIGINT          NOT NULL,   -- ref: atn_workshops
    capability_category         VARCHAR(64)     NOT NULL,
        -- ENGINE / TRANSMISSION / BRAKES / SUSPENSION / ELECTRICAL /
        -- BODYWORK / TYRES / AIRCON / HYBRID_EV / DIAGNOSTICS /
        -- AUTOCHECK_INSPECTION / SMART_GATE
    capability_detail           VARCHAR(256),
    is_accredited               BOOLEAN         NOT NULL DEFAULT FALSE,
    accreditation_ref           BIGINT,                     -- ref: atn_workshop_accreditations
    certified_at                DATE,
    expires_at                  DATE,
    notes                       TEXT,
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 6. Workshop Accreditations
--    Formal certifications and accreditations held by a workshop.
-- -----------------------------------------------------------------------------
CREATE TABLE atn_workshop_accreditations (
    workshop_accreditation_id   BIGSERIAL PRIMARY KEY,
    workshop_id                 BIGINT          NOT NULL,   -- ref: atn_workshops
    accreditation_type          VARCHAR(64)     NOT NULL,
        -- AUTOCHECK_PROVIDER / MANUFACTURER_CERTIFIED / GOVERNMENT_INSPECTION /
        -- BRAND_AUTHORIZED / INSURANCE_APPROVED / SAFETY_INSPECTION
    issuing_body                VARCHAR(256),
    certificate_ref             VARCHAR(256),
    issued_at                   DATE,
    expires_at                  DATE,
    status                      VARCHAR(32)     NOT NULL DEFAULT 'ACTIVE',
        -- ACTIVE / EXPIRED / SUSPENDED / REVOKED
    document_ref                VARCHAR(256),               -- object storage reference — no PII
    notes                       TEXT,
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- PART 3 — INTEGRATION
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 7. Integration Connectors
--    How each workshop connects to the Atelier Network platform API.
-- -----------------------------------------------------------------------------
CREATE TABLE atn_integration_connectors (
    connector_id                BIGSERIAL PRIMARY KEY,
    workshop_id                 BIGINT          NOT NULL,   -- ref: atn_workshops
    integration_mode            VARCHAR(32)     NOT NULL,
        -- NATIVE_MANAGED / EXTERNAL_CONNECTED / HYBRID
    connector_type              VARCHAR(64),                -- REST_API / WEBHOOK / BATCH_SYNC
    external_system_name        VARCHAR(256),               -- name of their existing system if EXTERNAL
    api_version                 VARCHAR(32),
    is_active                   BOOLEAN         NOT NULL DEFAULT FALSE,
    activated_at                TIMESTAMPTZ,
    last_sync_at                TIMESTAMPTZ,
    legal_review_completed      BOOLEAN         NOT NULL DEFAULT FALSE,
    notes                       TEXT,
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 8. Service Catalogue Items
--    Services offered through the platform. Generic; workshop-configurable.
-- -----------------------------------------------------------------------------
CREATE TABLE atn_service_catalog_items (
    service_catalog_item_id     BIGSERIAL PRIMARY KEY,
    workshop_id                 BIGINT          NOT NULL,   -- ref: atn_workshops
    service_code                VARCHAR(64)     NOT NULL,
    service_name_fr             VARCHAR(256)    NOT NULL,
    service_name_ar             VARCHAR(256),
    service_category            VARCHAR(64)     NOT NULL,
        -- INSPECTION / REPAIR / MAINTENANCE / PARTS / AUTOCHECK / OTHER
    duration_minutes            INTEGER,
    price_tnd                   NUMERIC(10, 3),
    price_is_estimated          BOOLEAN         NOT NULL DEFAULT TRUE,
    requires_vehicle_id         BOOLEAN         NOT NULL DEFAULT TRUE,
    access_scope                VARCHAR(32)     NOT NULL DEFAULT 'public',
    is_active                   BOOLEAN         NOT NULL DEFAULT TRUE,
    notes                       TEXT,
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- PART 4 — TECHNICIANS AND STAFF
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 9. Technicians
--    Staff registry within an organisation. No customer PII.
-- -----------------------------------------------------------------------------
CREATE TABLE atn_technicians (
    technician_id               BIGSERIAL PRIMARY KEY,
    workshop_organization_id    BIGINT          NOT NULL,   -- ref: atn_workshop_organizations
    mythos_user_ref             BIGINT,                     -- mythos_core.mythos_user_id — no FK
    display_name                VARCHAR(128)    NOT NULL,   -- no full PII stored here
    specialisations             TEXT[],                     -- capability categories
    is_autocheck_certified      BOOLEAN         NOT NULL DEFAULT FALSE,
    autocheck_cert_ref          BIGINT,                     -- ref: atn_workshop_accreditations
    status                      VARCHAR(32)     NOT NULL DEFAULT 'ACTIVE',
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 10. Technician Assignments
--     Assignment of technicians to workshops (may rotate between sites).
-- -----------------------------------------------------------------------------
CREATE TABLE atn_technician_assignments (
    technician_assignment_id    BIGSERIAL PRIMARY KEY,
    technician_id               BIGINT          NOT NULL,   -- ref: atn_technicians
    workshop_site_id            BIGINT          NOT NULL,   -- ref: atn_workshop_sites
    role_at_site                VARCHAR(64),                -- LEAD_TECHNICIAN / INSPECTOR / GENERALIST
    assigned_at                 TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    unassigned_at               TIMESTAMPTZ,
    is_primary_site             BOOLEAN         NOT NULL DEFAULT TRUE,
    notes                       TEXT,
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- PART 5 — APPOINTMENTS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 11. Appointments
--     Appointment bookings. Customer PII is NOT stored here — only vehicle
--     reference and booking metadata. Full customer record stays in each
--     workshop organisation's own tables.
-- -----------------------------------------------------------------------------
CREATE TABLE atn_appointments (
    appointment_id              BIGSERIAL PRIMARY KEY,
    workshop_site_id            BIGINT          NOT NULL,   -- ref: atn_workshop_sites
    vehicle_id_ref              BIGINT,                     -- idauto.vehicles.vehicle_id — no FK
    service_catalog_item_id     BIGINT,                     -- ref: atn_service_catalog_items
    customer_org_ref            VARCHAR(256),               -- opaque reference in workshop's own system
    scheduled_at                TIMESTAMPTZ     NOT NULL,
    duration_minutes            INTEGER,
    appointment_type            VARCHAR(64),
        -- INSPECTION / REPAIR / MAINTENANCE / AUTOCHECK / SMART_GATE_ARRIVAL / OTHER
    status                      VARCHAR(32)     NOT NULL DEFAULT 'PENDING',
        -- PENDING / CONFIRMED / CHECKED_IN / IN_PROGRESS / COMPLETED / CANCELLED / NO_SHOW
    access_scope                VARCHAR(32)     NOT NULL DEFAULT 'organization_private',
    notes                       TEXT,                       -- no customer PII in notes
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- PART 6 — INSPECTION AND AUTOCHECK
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 12. Inspection Providers
--     Registry of organisations authorised to deliver AutoCheck inspections.
-- -----------------------------------------------------------------------------
CREATE TABLE atn_inspection_providers (
    inspection_provider_id      BIGSERIAL PRIMARY KEY,
    workshop_organization_id    BIGINT          NOT NULL,   -- ref: atn_workshop_organizations
    provider_name               VARCHAR(256)    NOT NULL,
    report_brand_name           VARCHAR(256)    NOT NULL,   -- e.g. "AutoCheck by Fixpert"
    is_active                   BOOLEAN         NOT NULL DEFAULT FALSE,
    accreditation_ref           BIGINT,                     -- ref: atn_workshop_accreditations
    accredited_at               DATE,
    accreditation_expires_at    DATE,
    legal_review_completed      BOOLEAN         NOT NULL DEFAULT FALSE,
    notes                       TEXT,
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 13. Inspections
--     Inspection records. A top-level inspection event linked to a vehicle.
-- -----------------------------------------------------------------------------
CREATE TABLE atn_inspections (
    inspection_id               BIGSERIAL PRIMARY KEY,
    workshop_site_id            BIGINT          NOT NULL,   -- ref: atn_workshop_sites
    inspection_provider_id      BIGINT          NOT NULL,   -- ref: atn_inspection_providers
    vehicle_id_ref              BIGINT          NOT NULL,   -- idauto.vehicles.vehicle_id — no FK
    appointment_id              BIGINT,                     -- ref: atn_appointments
    inspection_type             VARCHAR(64)     NOT NULL,
        -- AUTOCHECK / DIAGNOSTIC_ONLY / GOVERNMENT_INSPECTION / FLEET_INSPECTION
    protocol_version            VARCHAR(32),                -- AutoCheck standard version used
    inspector_technician_id     BIGINT,                     -- ref: atn_technicians
    started_at                  TIMESTAMPTZ,
    completed_at                TIMESTAMPTZ,
    status                      VARCHAR(32)     NOT NULL DEFAULT 'SCHEDULED',
        -- SCHEDULED / IN_PROGRESS / COMPLETED / CANCELLED / FAILED
    overall_rating              VARCHAR(32),
        -- PASS / PASS_WITH_NOTES / FAIL / INCOMPLETE
    access_scope                VARCHAR(32)     NOT NULL DEFAULT 'organization_private',
    notes                       TEXT,                       -- no customer PII
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 14. Inspection Items
--     Checklist items for a given inspection (from AutoCheck standard).
-- -----------------------------------------------------------------------------
CREATE TABLE atn_inspection_items (
    inspection_item_id          BIGSERIAL PRIMARY KEY,
    inspection_id               BIGINT          NOT NULL,   -- ref: atn_inspections
    section_code                VARCHAR(64)     NOT NULL,
        -- IDENTITY_DOCS / DIAGNOSTIC / ENGINE / GEARBOX / BRAKES / SUSPENSION /
        -- STEERING / TYRES / BATTERY_EV / ELECTRICAL / AIRCON / BODYWORK /
        -- ROAD_TEST / REPAIR_IMMEDIATE / REPAIR_FUTURE / PARTS_ESTIMATE /
        -- LABOUR_ESTIMATE / RISK_NOTES
    item_code                   VARCHAR(128)    NOT NULL,
    item_description_fr         VARCHAR(512),
    item_description_ar         VARCHAR(512),
    result                      VARCHAR(32),
        -- OK / ATTENTION / FAIL / NOT_APPLICABLE / NOT_CHECKED
    severity                    VARCHAR(16),
        -- LOW / MEDIUM / HIGH / CRITICAL
    sort_order                  INTEGER,
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 15. Inspection Findings
--     Detailed findings per inspection item. Free-text notes and coded findings.
-- -----------------------------------------------------------------------------
CREATE TABLE atn_inspection_findings (
    finding_id                  BIGSERIAL PRIMARY KEY,
    inspection_item_id          BIGINT          NOT NULL,   -- ref: atn_inspection_items
    finding_type                VARCHAR(64),
        -- DEFECT / WEAR / MISSING_DOCUMENT / FAULT_CODE / NOTE
    description_fr              TEXT,
    description_ar              TEXT,
    estimated_repair_cost_tnd   NUMERIC(10, 3),
    urgency                     VARCHAR(32),
        -- IMMEDIATE / NEXT_SERVICE / MONITORING / NONE
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- PART 7 — WORK ORDERS AND INTERVENTIONS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 16. Work Orders
--     Work order lifecycle. Each work order is linked to one vehicle.
--     Customer details remain in the workshop organisation's own tables.
-- -----------------------------------------------------------------------------
CREATE TABLE atn_work_orders (
    work_order_id               BIGSERIAL PRIMARY KEY,
    workshop_site_id            BIGINT          NOT NULL,   -- ref: atn_workshop_sites
    vehicle_id_ref              BIGINT          NOT NULL,   -- idauto.vehicles.vehicle_id — no FK
    appointment_id              BIGINT,                     -- ref: atn_appointments
    inspection_id               BIGINT,                     -- ref: atn_inspections
    customer_org_ref            VARCHAR(256),               -- opaque reference to workshop's customer record
    opened_at                   TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    closed_at                   TIMESTAMPTZ,
    status                      VARCHAR(32)     NOT NULL DEFAULT 'OPEN',
        -- OPEN / IN_PROGRESS / AWAITING_PARTS / AWAITING_APPROVAL / CLOSED / CANCELLED
    access_scope                VARCHAR(32)     NOT NULL DEFAULT 'organization_private',
    notes                       TEXT,                       -- no customer PII
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 17. Work Order Lines
--     Service and parts lines associated with a work order.
-- -----------------------------------------------------------------------------
CREATE TABLE atn_work_order_lines (
    line_id                     BIGSERIAL PRIMARY KEY,
    work_order_id               BIGINT          NOT NULL,   -- ref: atn_work_orders
    line_type                   VARCHAR(32)     NOT NULL,
        -- LABOUR / PART / INSPECTION_FEE / OTHER
    description_fr              VARCHAR(512),
    quantity                    NUMERIC(10, 3),
    unit_price_tnd              NUMERIC(10, 3),
    total_price_tnd             NUMERIC(10, 3),
    part_ref                    VARCHAR(128),               -- opaque parts ref (Parts Network)
    sort_order                  INTEGER,
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 18. Interventions
--     Individual repair or maintenance tasks performed on a work order.
-- -----------------------------------------------------------------------------
CREATE TABLE atn_interventions (
    intervention_id             BIGSERIAL PRIMARY KEY,
    work_order_id               BIGINT          NOT NULL,   -- ref: atn_work_orders
    technician_id               BIGINT,                     -- ref: atn_technicians
    intervention_type           VARCHAR(64)     NOT NULL,
        -- REPAIR / MAINTENANCE / PARTS_REPLACEMENT / DIAGNOSTIC / INSPECTION_TASK
    description_fr              TEXT,
    started_at                  TIMESTAMPTZ,
    completed_at                TIMESTAMPTZ,
    labour_hours                NUMERIC(5, 2),
    status                      VARCHAR(32)     NOT NULL DEFAULT 'PENDING',
        -- PENDING / IN_PROGRESS / COMPLETED / CANCELLED
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- PART 8 — REPAIR ESTIMATES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 19. Repair Estimates
--     Estimates produced after inspection. Consumed by AutoValeur for
--     post-inspection valuation (ATN-1 / AVA-2 scope).
-- -----------------------------------------------------------------------------
CREATE TABLE atn_repair_estimates (
    repair_estimate_id          BIGSERIAL PRIMARY KEY,
    inspection_id               BIGINT,                     -- ref: atn_inspections
    work_order_id               BIGINT,                     -- ref: atn_work_orders
    vehicle_id_ref              BIGINT          NOT NULL,   -- idauto.vehicles.vehicle_id — no FK
    inspection_provider_id      BIGINT,                     -- ref: atn_inspection_providers
    estimate_type               VARCHAR(32)     NOT NULL DEFAULT 'POST_INSPECTION',
        -- POST_INSPECTION / PRE_WORK / INSURANCE_CLAIM
    labour_total_tnd            NUMERIC(12, 3),
    parts_total_tnd             NUMERIC(12, 3),
    grand_total_tnd             NUMERIC(12, 3),
    confidence_level            VARCHAR(16),                -- HIGH / MEDIUM / LOW
    valid_until                 DATE,
    access_scope                VARCHAR(32)     NOT NULL DEFAULT 'professional',
    notes                       TEXT,                       -- no customer PII
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 20. Repair Estimate Lines
--     Line items within a repair estimate.
-- -----------------------------------------------------------------------------
CREATE TABLE atn_repair_estimate_lines (
    estimate_line_id            BIGSERIAL PRIMARY KEY,
    repair_estimate_id          BIGINT          NOT NULL,   -- ref: atn_repair_estimates
    line_type                   VARCHAR(32)     NOT NULL,
        -- LABOUR / PART / CONSUMABLE / OTHER
    description_fr              VARCHAR(512),
    quantity                    NUMERIC(10, 3),
    unit_price_tnd              NUMERIC(10, 3),
    total_price_tnd             NUMERIC(10, 3),
    urgency                     VARCHAR(32),
        -- IMMEDIATE / NEXT_SERVICE / MONITORING / NONE
    part_ref                    VARCHAR(128),               -- opaque ref to Parts Network
    sort_order                  INTEGER,
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- PART 9 — EXTERNAL WORKSHOP RECORDS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 21. External Workshop Records
--     Summarised records from EXTERNAL_CONNECTED workshops. These are
--     normalised references only — the source of truth remains in the
--     external system. Allows cross-product integrations without
--     reproducing the external system's full data model.
-- -----------------------------------------------------------------------------
CREATE TABLE atn_external_workshop_records (
    external_workshop_record_id BIGSERIAL PRIMARY KEY,
    workshop_id                 BIGINT          NOT NULL,   -- ref: atn_workshops
    external_system_name        VARCHAR(128)    NOT NULL,
    external_record_type        VARCHAR(64)     NOT NULL,
        -- APPOINTMENT / WORK_ORDER / INSPECTION / INVOICE
    external_record_ref         VARCHAR(256)    NOT NULL,   -- ID in the external system
    vehicle_id_ref              BIGINT,                     -- idauto.vehicles.vehicle_id — no FK
    event_date                  DATE,
    summary_data                JSONB,                      -- minimal summary — no customer PII
    source_hash                 VARCHAR(64),                -- SHA-256 of source payload for dedup
    sync_status                 VARCHAR(32)     NOT NULL DEFAULT 'RECEIVED',
        -- RECEIVED / MAPPED / ACCEPTED / REJECTED
    access_scope                VARCHAR(32)     NOT NULL DEFAULT 'organization_private',
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- PART 10 — SMART GATE
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 22. Smart Gate Devices
--     Registry of Smart Gate camera devices per workshop.
--     Each workshop owns its device and its consent/notice obligation.
--     Vehicle observations produced by the device are owned by ID Auto.
-- -----------------------------------------------------------------------------
CREATE TABLE atn_smart_gate_devices (
    smart_gate_device_id        BIGSERIAL PRIMARY KEY,
    workshop_site_id            BIGINT          NOT NULL,   -- ref: atn_workshop_sites
    device_label                VARCHAR(128)    NOT NULL,   -- e.g. "Entrance camera 1"
    device_location             VARCHAR(256),               -- entrance / exit / both
    legal_review_completed      BOOLEAN         NOT NULL DEFAULT FALSE,
    anpr_approval_ref           VARCHAR(256),               -- regulatory approval reference
    consent_notice_displayed    BOOLEAN         NOT NULL DEFAULT FALSE,
    is_active                   BOOLEAN         NOT NULL DEFAULT FALSE,
    activated_at                TIMESTAMPTZ,
    id_auto_stream_enabled      BOOLEAN         NOT NULL DEFAULT FALSE,
    notes                       TEXT,
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- PART 11 — CONSENT AND AUDIT
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 23. Customer Consents
--     Consent records per workshop organisation. Not a global customer DB.
--     Each org collects and manages its own customer consents.
--     This table records the consent metadata only — not the PII itself.
-- -----------------------------------------------------------------------------
CREATE TABLE atn_customer_consents (
    consent_id                  BIGSERIAL PRIMARY KEY,
    workshop_organization_id    BIGINT          NOT NULL,   -- ref: atn_workshop_organizations
    customer_org_ref            VARCHAR(256)    NOT NULL,   -- opaque ref to customer in org's own system
    consent_type                VARCHAR(64)     NOT NULL,
        -- DATA_PROCESSING / CARTE_GRISE_OCR / SMART_GATE_NOTICE /
        -- MARKETING / CROSS_PRODUCT_SHARE
    consent_granted             BOOLEAN         NOT NULL,
    consented_at                TIMESTAMPTZ,
    withdrawn_at                TIMESTAMPTZ,
    purpose                     TEXT,
    legal_basis                 VARCHAR(128),
    access_scope                VARCHAR(32)     NOT NULL DEFAULT 'organization_private',
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 24. Audit Events
--     Network-level audit log. Product-internal access events and
--     cross-organisation events by NETWORK_SUPER_ADMIN.
-- -----------------------------------------------------------------------------
CREATE TABLE atn_audit_events (
    audit_event_id              BIGSERIAL PRIMARY KEY,
    event_id                    UUID            NOT NULL,   -- cross-product correlation UUID v4
    event_name                  VARCHAR(256)    NOT NULL,
    actor_ref                   BIGINT,                     -- mythos_core.mythos_user_id — no FK
    actor_role                  VARCHAR(64),
    workshop_organization_id    BIGINT,                     -- ref: atn_workshop_organizations (if org-scoped)
    target_table                VARCHAR(128),
    target_id                   BIGINT,
    action                      VARCHAR(32)     NOT NULL,   -- CREATE / READ / UPDATE / DELETE / AUDIT_WRITE
    access_scope                VARCHAR(32)     NOT NULL,
    privacy_class               VARCHAR(64),
    event_metadata              JSONB,                      -- no PII
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- End of schema.sql
-- Table count: 24
-- Status: DRAFT — NOT DEPLOYED
-- =============================================================================
