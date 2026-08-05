-- AutoValeur Database Schema Draft
-- Target DBMS: PostgreSQL
-- Status: NOT INSTALLED OR DEPLOYED — AVA-0 draft specification only
-- Stage: AVA-0 — Foundation and Ecosystem Roadmap
-- Date: 2026-08-05
--
-- This file is a design document. No PostgreSQL instance exists.
-- Schema name: autovaleur (logical schema, shared PostgreSQL cluster)
-- Do not execute against any database until AVA-1 with explicit authorisation.
--
-- Ownership boundaries:
--   - vehicle identity belongs to idauto schema (read-only from AutoValeur)
--   - workshop client/customer data belongs to each workshop organisation (fixpert schema for Fixpert pilot; read-only references)
--   - inspection and repair estimate references use inspection_provider_id and repair_estimate_id from atelier_network schema
--   - marketplace seller data belongs to external sources (not copied here)
--   - AutoValeur owns: valuations, comparables, estimates, scores, deal pipeline, model versions, audit

-- =============================================================================
-- PART 1 — MODEL VERSIONS
-- =============================================================================

-- autovaleur_model_versions
-- Records every version of the valuation model. Mandatory on all result records.
CREATE TABLE autovaleur_model_versions (
    id                  BIGSERIAL PRIMARY KEY,
    version_code        VARCHAR(50)     NOT NULL UNIQUE,
    description         TEXT            NOT NULL,
    comparable_rules    JSONB,
    weighting_factors   JSONB,
    depreciation_curves JSONB,
    liquidity_rules     JSONB,
    opportunity_rules   JSONB,
    released_at         TIMESTAMPTZ     NOT NULL DEFAULT now(),
    deprecated_at       TIMESTAMPTZ,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- autovaleur_model_evaluations
-- Records accuracy evaluation results for each model version.
CREATE TABLE autovaleur_model_evaluations (
    id                          BIGSERIAL PRIMARY KEY,
    model_version_id            BIGINT      NOT NULL REFERENCES autovaleur_model_versions(id),
    evaluation_date             DATE        NOT NULL,
    sample_count                INT,
    mean_absolute_error_tnd     NUMERIC(12, 2),
    mean_absolute_pct_error     NUMERIC(6, 4),
    hit_rate_in_range_pct       NUMERIC(6, 4),
    time_to_sale_accuracy_pct   NUMERIC(6, 4),
    notes                       TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- PART 2 — SOURCE CATALOGUE
-- =============================================================================

-- autovaleur_source_catalogue
-- Every data source that may feed market listings, comparables, parts quotes.
-- No data is admitted without a known, documented source.
CREATE TABLE autovaleur_source_catalogue (
    id              BIGSERIAL PRIMARY KEY,
    source_code     VARCHAR(100)    NOT NULL UNIQUE,
    source_name     VARCHAR(255)    NOT NULL,
    source_type     VARCHAR(50)     NOT NULL,
    -- source_type: marketplace / parts_platform / transaction_registry / internal / manual
    trust_level     SMALLINT        NOT NULL DEFAULT 1 CHECK (trust_level BETWEEN 1 AND 5),
    -- 5=verified_transaction, 4=verified_listing, 3=authorised_feed, 2=public_listing, 1=manual_entry
    legal_status    VARCHAR(100)    NOT NULL DEFAULT 'LEGAL-REVIEW-REQUIRED',
    is_active       BOOLEAN         NOT NULL DEFAULT FALSE,
    data_feed_url   TEXT,
    terms_review_date   DATE,
    terms_reviewed_by   VARCHAR(255),
    notes           TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- Seed data — sources defined but not activated
INSERT INTO autovaleur_source_catalogue
    (source_code, source_name, source_type, trust_level, legal_status, is_active)
VALUES
    ('SSANGYONG_AUTOS', 'ssangyong.autos', 'parts_platform', 3, 'LEGAL-REVIEW-REQUIRED', FALSE),
    ('INTERNAL_MANUAL', 'Mythos manual entry', 'manual', 1, 'internal', FALSE),
    ('FIXPERT_INSPECTIONS', 'Fixpert Atelier inspection results', 'internal', 4, 'internal', FALSE);

-- =============================================================================
-- PART 3 — MARKET LISTINGS AND PRICE HISTORY
-- =============================================================================

-- autovaleur_market_listings
-- Snapshots of vehicle listings from authorised marketplace sources.
-- Asking prices and completed sale prices are always separate fields.
-- No seller PII stored.
CREATE TABLE autovaleur_market_listings (
    id                      BIGSERIAL PRIMARY KEY,
    source_id               BIGINT      NOT NULL REFERENCES autovaleur_source_catalogue(id),
    external_listing_id     VARCHAR(255),
    idauto_vehicle_id       BIGINT,
    -- cross-schema reference to idauto.vehicles.id — no FK enforced across schemas
    make                    VARCHAR(100),
    model                   VARCHAR(100),
    variant                 VARCHAR(100),
    year                    SMALLINT,
    fuel_type               VARCHAR(50),
    body_type               VARCHAR(50),
    mileage_km              INT,
    region                  VARCHAR(100),
    asking_price            NUMERIC(12, 2),
    accepted_offer_price    NUMERIC(12, 2),
    completed_sale_price    NUMERIC(12, 2),
    -- asking_price and completed_sale_price are NEVER merged or averaged
    listing_date            DATE,
    sale_date               DATE,
    time_to_sale_days       INT,
    listing_status          VARCHAR(50),
    -- listing_status: active / sold / expired / removed / unknown
    image_hash              VARCHAR(64),
    -- for duplicate detection — no image binary stored
    is_duplicate            BOOLEAN     NOT NULL DEFAULT FALSE,
    duplicate_of_id         BIGINT      REFERENCES autovaleur_market_listings(id),
    access_scope            VARCHAR(30) NOT NULL DEFAULT 'mythos_private',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- autovaleur_listing_price_snapshots
-- Tracks price changes on a single listing over time.
CREATE TABLE autovaleur_listing_price_snapshots (
    id              BIGSERIAL PRIMARY KEY,
    listing_id      BIGINT      NOT NULL REFERENCES autovaleur_market_listings(id),
    observed_price  NUMERIC(12, 2)  NOT NULL,
    observed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- PART 4 — VALUATIONS (IMMUTABLE SNAPSHOTS)
-- =============================================================================

-- autovaleur_valuations
-- Core valuation record. Immutable once created.
-- Every valuation records the model version used.
-- Historical valuations are never overwritten.
CREATE TABLE autovaleur_valuations (
    id                          BIGSERIAL PRIMARY KEY,
    model_version_id            BIGINT      NOT NULL REFERENCES autovaleur_model_versions(id),
    model_version               VARCHAR(50) NOT NULL,
    request_id                  UUID        NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    -- caller / requester
    requester_type              VARCHAR(50) NOT NULL,
    -- requester_type: public / professional / mythos_admin
    requester_ref               BIGINT,
    -- reference to mythos_core user or org, NULL for anonymous public
    -- id auto reference
    idauto_vehicle_id           BIGINT,
    idauto_snapshot_json        JSONB,
    -- snapshot of idauto facts used at valuation time — labelled as snapshot
    -- vehicle details (may come from manual input or idauto snapshot)
    make                        VARCHAR(100),
    model                       VARCHAR(100),
    variant                     VARCHAR(100),
    year                        SMALLINT,
    fuel_type                   VARCHAR(50),
    body_type                   VARCHAR(50),
    mileage_km                  INT,
    declared_condition          VARCHAR(50),
    accident_history_declared   BOOLEAN,
    service_history_declared    BOOLEAN,
    -- valuation result fields — immutable
    estimated_range_min         NUMERIC(12, 2),
    estimated_range_max         NUMERIC(12, 2),
    central_market_value        NUMERIC(12, 2),
    quick_sale_price            NUMERIC(12, 2),
    professional_purchase_price NUMERIC(12, 2),
    professional_resale_price   NUMERIC(12, 2),
    repair_reconditioning_cost  NUMERIC(12, 2),
    additional_expenses         NUMERIC(12, 2),
    potential_gross_margin      NUMERIC(12, 2),
    potential_net_margin        NUMERIC(12, 2),
    expected_resale_days        INT,
    liquidity_score             NUMERIC(5, 2),
    opportunity_score           NUMERIC(5, 2),
    confidence_score            NUMERIC(5, 4) NOT NULL,
    comparable_count            INT,
    currency                    VARCHAR(10) NOT NULL DEFAULT 'TND',
    access_scope                VARCHAR(30) NOT NULL DEFAULT 'public',
    valuation_date              TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- accuracy feedback (filled later when sale occurs)
    actual_sale_price           NUMERIC(12, 2),
    actual_sale_date            DATE,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- autovaleur_valuation_inputs
-- Additional inputs used in the valuation, stored separately for audit.
CREATE TABLE autovaleur_valuation_inputs (
    id              BIGSERIAL PRIMARY KEY,
    valuation_id    BIGINT      NOT NULL REFERENCES autovaleur_valuations(id),
    input_key       VARCHAR(100) NOT NULL,
    input_value     TEXT,
    input_source    VARCHAR(100),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- PART 5 — COMPARABLE ANALYSIS
-- =============================================================================

-- autovaleur_comparables
-- The comparable vehicles selected for a specific valuation.
CREATE TABLE autovaleur_comparables (
    id                  BIGSERIAL PRIMARY KEY,
    valuation_id        BIGINT      NOT NULL REFERENCES autovaleur_valuations(id),
    listing_id          BIGINT      REFERENCES autovaleur_market_listings(id),
    source_id           BIGINT      NOT NULL REFERENCES autovaleur_source_catalogue(id),
    make                VARCHAR(100),
    model               VARCHAR(100),
    variant             VARCHAR(100),
    year                SMALLINT,
    fuel_type           VARCHAR(50),
    mileage_km          INT,
    region              VARCHAR(100),
    listed_price        NUMERIC(12, 2),
    sale_price          NUMERIC(12, 2),
    listing_age_days    INT,
    weight              NUMERIC(6, 4),
    price_after_weight  NUMERIC(12, 2),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- PART 6 — CONDITION REPORTS
-- =============================================================================

-- autovaleur_condition_reports
-- Condition inputs provided by the user or a professional.
-- No PII stored here — linked to valuation, not to a named person.
CREATE TABLE autovaleur_condition_reports (
    id                      BIGSERIAL PRIMARY KEY,
    valuation_id            BIGINT      REFERENCES autovaleur_valuations(id),
    report_type             VARCHAR(50) NOT NULL DEFAULT 'user_declared',
    -- report_type: user_declared / professional / post_autocheck_inspection
    condition_grade         VARCHAR(50),
    -- condition_grade: excellent / good / fair / poor / salvage
    accident_history        BOOLEAN,
    flood_damage            BOOLEAN,
    service_history         BOOLEAN,
    modification_present    BOOLEAN,
    modification_detail     TEXT,
    tyre_condition          VARCHAR(50),
    interior_condition      VARCHAR(50),
    mechanical_notes        TEXT,
    inspection_provider_id  BIGINT,
    -- stable reference to atelier_network.atn_inspection_providers.id — no workshop PII stored here
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- PART 7 — REPAIR AND RECONDITIONING ESTIMATES
-- =============================================================================

-- autovaleur_repair_estimates
-- Reconditioning cost estimates. References Atelier Network inspections — does not duplicate workshop data.
CREATE TABLE autovaleur_repair_estimates (
    id                      BIGSERIAL PRIMARY KEY,
    valuation_id            BIGINT      REFERENCES autovaleur_valuations(id),
    inspection_provider_id  BIGINT,
    -- stable reference to atelier_network.atn_inspection_providers.id
    repair_estimate_id      BIGINT,
    -- stable reference to atelier_network.atn_repair_estimates.id — no customer PII
    labour_rate_tnd_hr      NUMERIC(8, 2),
    labour_hours_total      NUMERIC(8, 2),
    labour_total_tnd        NUMERIC(12, 2),
    parts_total_tnd         NUMERIC(12, 2),
    subtotal_tnd            NUMERIC(12, 2),
    contingency_pct         NUMERIC(5, 2),
    contingency_tnd         NUMERIC(12, 2),
    total_estimate_tnd      NUMERIC(12, 2),
    estimate_date           TIMESTAMPTZ NOT NULL DEFAULT now(),
    access_scope            VARCHAR(30) NOT NULL DEFAULT 'professional',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- autovaleur_repair_estimate_lines
-- Individual repair line items (one per operation or part category).
CREATE TABLE autovaleur_repair_estimate_lines (
    id                  BIGSERIAL PRIMARY KEY,
    estimate_id         BIGINT      NOT NULL REFERENCES autovaleur_repair_estimates(id),
    line_type           VARCHAR(50) NOT NULL,
    -- line_type: labour / part / consumable / transport / admin / disposal
    description         VARCHAR(255) NOT NULL,
    quantity            NUMERIC(8, 2),
    unit_price_tnd      NUMERIC(10, 2),
    total_tnd           NUMERIC(12, 2),
    classification      VARCHAR(100),
    -- cosmetic / mechanical / electrical / safety / structural
    is_mandatory        BOOLEAN     NOT NULL DEFAULT TRUE,
    parts_quote_id      BIGINT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- autovaleur_parts_quotes
-- Parts price quotes from authorised parts platforms.
CREATE TABLE autovaleur_parts_quotes (
    id              BIGSERIAL PRIMARY KEY,
    source_id       BIGINT      NOT NULL REFERENCES autovaleur_source_catalogue(id),
    part_reference  VARCHAR(255) NOT NULL,
    part_name       VARCHAR(255),
    make            VARCHAR(100),
    model           VARCHAR(100),
    year_from       SMALLINT,
    year_to         SMALLINT,
    unit_price_tnd  NUMERIC(10, 2)  NOT NULL,
    availability    VARCHAR(50),
    -- in_stock / order_3_5_days / order_2_weeks / unavailable / unknown
    quote_date      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- PART 8 — LIQUIDITY AND OPPORTUNITY SCORES
-- =============================================================================

-- autovaleur_liquidity_scores
-- Liquidity score for a vehicle segment, computed periodically.
CREATE TABLE autovaleur_liquidity_scores (
    id                  BIGSERIAL PRIMARY KEY,
    model_version_id    BIGINT      NOT NULL REFERENCES autovaleur_model_versions(id),
    make                VARCHAR(100),
    model               VARCHAR(100),
    fuel_type           VARCHAR(50),
    body_type           VARCHAR(50),
    region              VARCHAR(100),
    score               NUMERIC(5, 2) NOT NULL,
    score_class         VARCHAR(50),
    expected_days_min   INT,
    expected_days_max   INT,
    demand_index        NUMERIC(6, 4),
    supply_ratio        NUMERIC(6, 4),
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- autovaleur_opportunity_scores
-- Opportunity score for individual listings (MYTHOS_PRIVATE Deal Radar).
CREATE TABLE autovaleur_opportunity_scores (
    id                          BIGSERIAL PRIMARY KEY,
    listing_id                  BIGINT      NOT NULL REFERENCES autovaleur_market_listings(id),
    valuation_id                BIGINT      REFERENCES autovaleur_valuations(id),
    model_version_id            BIGINT      NOT NULL REFERENCES autovaleur_model_versions(id),
    score                       NUMERIC(5, 2) NOT NULL,
    score_class                 VARCHAR(100),
    price_vs_market_pct         NUMERIC(8, 4),
    repair_vs_margin_ratio      NUMERIC(8, 4),
    liquidity_score             NUMERIC(5, 2),
    confidence_score            NUMERIC(5, 4),
    time_on_market_days         INT,
    parts_availability_flag     BOOLEAN,
    computed_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    access_scope                VARCHAR(30) NOT NULL DEFAULT 'mythos_private'
);

-- =============================================================================
-- PART 9 — DEAL RADAR AND PIPELINE (MYTHOS_PRIVATE)
-- =============================================================================

-- autovaleur_deal_alerts
-- Automatically detected high-opportunity listings. MYTHOS_PRIVATE.
-- Requires human review before any action.
CREATE TABLE autovaleur_deal_alerts (
    id                  BIGSERIAL PRIMARY KEY,
    listing_id          BIGINT      NOT NULL REFERENCES autovaleur_market_listings(id),
    opportunity_score_id BIGINT     REFERENCES autovaleur_opportunity_scores(id),
    opportunity_class   VARCHAR(100),
    alert_state         VARCHAR(50) NOT NULL DEFAULT 'detected',
    -- alert_state: detected / alerted / shortlisted / under_review / rejected / expired
    reviewed_by         VARCHAR(255),
    review_notes        TEXT,
    alerted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at         TIMESTAMPTZ,
    access_scope        VARCHAR(30) NOT NULL DEFAULT 'mythos_private',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- autovaleur_deal_pipeline
-- Acquisition pipeline entries for shortlisted vehicles. MYTHOS_PRIVATE.
-- No automatic purchase. No automatic seller contact.
CREATE TABLE autovaleur_deal_pipeline (
    id                      BIGSERIAL PRIMARY KEY,
    alert_id                BIGINT      NOT NULL REFERENCES autovaleur_deal_alerts(id),
    listing_id              BIGINT      NOT NULL REFERENCES autovaleur_market_listings(id),
    pipeline_state          VARCHAR(50) NOT NULL DEFAULT 'shortlisted',
    -- pipeline_state: shortlisted / contact_authorised / negotiating / purchased / closed_no_deal / expired
    target_purchase_price   NUMERIC(12, 2),
    actual_purchase_price   NUMERIC(12, 2),
    target_resale_price     NUMERIC(12, 2),
    estimated_margin        NUMERIC(12, 2),
    realised_margin         NUMERIC(12, 2),
    purchase_date           DATE,
    assigned_to             VARCHAR(255),
    notes                   TEXT,
    state_updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    access_scope            VARCHAR(30) NOT NULL DEFAULT 'mythos_private',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- autovaleur_transactions
-- Records of completed vehicle transactions (purchase, resale).
-- References marketplace listing by stable ID only. No buyer/seller PII.
CREATE TABLE autovaleur_transactions (
    id                      BIGSERIAL PRIMARY KEY,
    pipeline_id             BIGINT      REFERENCES autovaleur_deal_pipeline(id),
    marketplace_listing_ref VARCHAR(255),
    -- stable external reference to marketplace listing
    transaction_type        VARCHAR(50) NOT NULL,
    -- transaction_type: purchase / resale
    transaction_price       NUMERIC(12, 2) NOT NULL,
    transaction_date        DATE        NOT NULL,
    valuation_id_at_time    BIGINT      REFERENCES autovaleur_valuations(id),
    notes                   TEXT,
    access_scope            VARCHAR(30) NOT NULL DEFAULT 'mythos_private',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- PART 10 — AUDIT EVENTS
-- =============================================================================

-- autovaleur_audit_events
-- Audit log for all significant events, especially MYTHOS_PRIVATE access.
-- All Mythos Super Admin access to AutoValeur data is recorded here.
CREATE TABLE autovaleur_audit_events (
    id              BIGSERIAL PRIMARY KEY,
    event_type      VARCHAR(100)    NOT NULL,
    actor_ref       BIGINT,
    -- reference to mythos_core user — NULL for anonymous/system
    actor_role      VARCHAR(100),
    target_table    VARCHAR(100),
    target_id       BIGINT,
    action          VARCHAR(50)     NOT NULL,
    access_scope    VARCHAR(30),
    event_metadata  JSONB,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- =============================================================================
-- INDEXES (representative — complete index set deferred to AVA-1)
-- =============================================================================

CREATE INDEX idx_avl_valuations_idauto   ON autovaleur_valuations (idauto_vehicle_id);
CREATE INDEX idx_avl_valuations_date     ON autovaleur_valuations (valuation_date);
CREATE INDEX idx_avl_valuations_scope    ON autovaleur_valuations (access_scope);
CREATE INDEX idx_avl_listings_idauto     ON autovaleur_market_listings (idauto_vehicle_id);
CREATE INDEX idx_avl_listings_source     ON autovaleur_market_listings (source_id);
CREATE INDEX idx_avl_listings_scope      ON autovaleur_market_listings (access_scope);
CREATE INDEX idx_avl_comparables_val     ON autovaleur_comparables (valuation_id);
CREATE INDEX idx_avl_deal_alerts_scope   ON autovaleur_deal_alerts (access_scope);
CREATE INDEX idx_avl_deal_pipeline_scope ON autovaleur_deal_pipeline (access_scope);
CREATE INDEX idx_avl_audit_actor         ON autovaleur_audit_events (actor_ref);
CREATE INDEX idx_avl_audit_created       ON autovaleur_audit_events (created_at);

-- =============================================================================
-- END OF SCHEMA DRAFT
--
-- Table count: 18
--   autovaleur_model_versions
--   autovaleur_model_evaluations
--   autovaleur_source_catalogue
--   autovaleur_market_listings
--   autovaleur_listing_price_snapshots
--   autovaleur_valuations
--   autovaleur_valuation_inputs
--   autovaleur_comparables
--   autovaleur_condition_reports
--   autovaleur_repair_estimates
--   autovaleur_repair_estimate_lines
--   autovaleur_parts_quotes
--   autovaleur_liquidity_scores
--   autovaleur_opportunity_scores
--   autovaleur_deal_alerts
--   autovaleur_deal_pipeline
--   autovaleur_transactions
--   autovaleur_audit_events
--
-- Status: NOT INSTALLED OR DEPLOYED
-- Next step: AVA-1 — implement PostgreSQL cluster and core tables
-- =============================================================================
