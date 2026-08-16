-- =============================================================================
-- SsangYong Parts (SSANGYONG.AUTOS) — Catalog Schema (Draft)
-- Stage:   SSANGYONG.AUTOS Stage 3 — schema design only
-- Date:    2026-08-16
-- Schema:  ssangyong_autos (separate logical schema; not idauto / autovaleur /
--          mythos_automotive / mythos_automation — no cross-schema FKs)
--
-- STATUS: DRAFT — NOT DEPLOYED. NOT EXECUTED.
-- No table has been created. No row has been inserted. No migration script
-- exists yet. Provisioning requires explicit owner authorisation in a future
-- stage. Google Sheets, PostgreSQL, n8n and the scraper are unchanged.
--
-- Table count: 5 (all prefixed sya_) + 1 documented deferred proposal
--   sya_products
--   sya_vehicle_models
--   sya_vehicle_motorizations
--   sya_product_vehicle_compatibility
--   sya_product_images
--   (deferred, documented only: sya_product_price_history)
--
-- Design rules applied (repository convention):
--   - BIGSERIAL internal PK paired with a stable opaque external identifier
--     (product_uid), so external systems never depend on the serial value.
--     product_uid is NOT an invented SKU: it is 'autopart.tn:<fiche-id>',
--     the source site's own numeric product id embedded in product_url,
--     verified 1:1 with product_url across all 346 canonical products.
--   - All timestamps TIMESTAMPTZ, stored and interpreted as UTC.
--   - Intra-schema FKs only. No cross-schema foreign keys.
--   - No secret-value columns. No PII columns.
--   - Requires PostgreSQL 15+ (UNIQUE NULLS NOT DISTINCT; production idauto
--     host is PG 15.18).
-- =============================================================================

-- CREATE SCHEMA ssangyong_autos;  -- deferred; all tables below live in it

-- -----------------------------------------------------------------------------
-- 1. sya_products — one row per canonical product (expected 346)
--    Natural identity: product_url. Business identity:
--    (source, product_brand, canonical_reference).
--    category_url is deliberately ABSENT here: it is vehicle-context-specific
--    and belongs to sya_product_vehicle_compatibility.
-- -----------------------------------------------------------------------------
CREATE TABLE sya_products (
    id                   BIGSERIAL PRIMARY KEY,
    product_uid          VARCHAR(64)  NOT NULL UNIQUE,      -- 'autopart.tn:<fiche-id>' (site-native, not invented)
    source               VARCHAR(64)  NOT NULL,             -- 'autopart.tn'
    product_brand        VARCHAR(128) NOT NULL,             -- part manufacturer (ASHIKA, FEBI BILSTEIN, …)
    canonical_reference  VARCHAR(64)  NOT NULL,             -- URL-verified, leading zeros preserved (TEXT, never numeric)
    product_title        TEXT         NOT NULL,
    oem_reference        TEXT,                              -- raw OEM cross-reference string as scraped
    pair_reference       VARCHAR(64),
    criteria_text        TEXT,
    technical_specs      JSONB,                             -- parsed from technical_specs_json (validated: 0 invalid)
    availability         VARCHAR(32)  NOT NULL,             -- controlled vocabulary, seeded from data
    price_tnd            NUMERIC(8,2) NOT NULL,
    currency             CHAR(3)      NOT NULL DEFAULT 'TND',
    delivery_note        TEXT,                              -- empty in current data; kept nullable for future scrapes
    product_url          TEXT         NOT NULL,
    status               VARCHAR(16)  NOT NULL DEFAULT 'active',
    collected_at         TIMESTAMPTZ  NOT NULL,             -- first seen by scraper
    last_checked_at      TIMESTAMPTZ  NOT NULL,             -- last confirmed by scraper
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT sya_products_product_url_key
        UNIQUE (product_url),
    CONSTRAINT sya_products_business_identity_key
        UNIQUE (source, product_brand, canonical_reference),
    CONSTRAINT sya_products_price_positive
        CHECK (price_tnd > 0),
    CONSTRAINT sya_products_currency_iso
        CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT sya_products_url_shape
        CHECK (product_url ~ '^https://'),
    CONSTRAINT sya_products_reference_not_blank
        CHECK (length(trim(canonical_reference)) > 0),
    CONSTRAINT sya_products_status_domain
        CHECK (status IN ('active', 'updated', 'inactive', 'delisted')),
    CONSTRAINT sya_products_availability_domain
        CHECK (availability IN ('En Stock', 'Sur Commande', 'Indisponible')),
        -- observed today: only 'En Stock' (346/346); the other two values are
        -- reserved so a future scrape cannot silently insert free text
    CONSTRAINT sya_products_checked_after_collected
        CHECK (last_checked_at >= collected_at)
);

CREATE INDEX sya_products_reference_idx  ON sya_products (canonical_reference);
CREATE INDEX sya_products_brand_idx      ON sya_products (product_brand);
CREATE INDEX sya_products_specs_gin_idx  ON sya_products USING GIN (technical_specs);

-- -----------------------------------------------------------------------------
-- 2. sya_vehicle_models — normalized from the Sheets `models` tab.
--    'KORANDO (KJ)' style labels are split: model_name='KORANDO',
--    generation_code='KJ'. model_url is the site-native natural key.
-- -----------------------------------------------------------------------------
CREATE TABLE sya_vehicle_models (
    id               BIGSERIAL PRIMARY KEY,
    source           VARCHAR(64)  NOT NULL,                 -- 'autopart.tn'
    brand_car        VARCHAR(64)  NOT NULL,                 -- 'SSANGYONG'
    model_name       VARCHAR(128) NOT NULL,                 -- 'KORANDO', 'ACTYON SPORTS I', …
    generation_code  VARCHAR(32),                           -- 'KJ', 'QJ', … NULL when the site defines none
    model_url        TEXT         NOT NULL,
    year_from        INTEGER,
    year_to          INTEGER,                               -- NULL = still in production
    collected_at     TIMESTAMPTZ  NOT NULL,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT sya_vehicle_models_url_key
        UNIQUE (model_url),
    CONSTRAINT sya_vehicle_models_identity_key
        UNIQUE NULLS NOT DISTINCT (source, brand_car, model_name, generation_code),
    CONSTRAINT sya_vehicle_models_year_order
        CHECK (year_to IS NULL OR year_from IS NULL OR year_to >= year_from),
    CONSTRAINT sya_vehicle_models_year_domain
        CHECK (year_from IS NULL OR year_from BETWEEN 1950 AND 2100)
);

-- -----------------------------------------------------------------------------
-- 3. sya_vehicle_motorizations — normalized from the Sheets `motorizations`
--    tab. motorisation_url is the site-native natural key (embeds the site's
--    numeric motorization id, which distinguishes same-label variants with
--    different year ranges). Motorisation label is TEXT — the Stage 2 date
--    coercion ('2.3' → 2026-03-02) is exactly what strong typing here prevents.
-- -----------------------------------------------------------------------------
CREATE TABLE sya_vehicle_motorizations (
    id                BIGSERIAL PRIMARY KEY,
    vehicle_model_id  BIGINT       NOT NULL REFERENCES sya_vehicle_models (id),
    motorisation      VARCHAR(64)  NOT NULL,                -- '2.0 Xdi 4WD', '2.3', '2.9 D (KJ)', …
    motorisation_url  TEXT         NOT NULL,
    year_from         INTEGER,
    year_to           INTEGER,                              -- NULL = still in production
    power             VARCHAR(64),                          -- as scraped ('88 kW / 120 hp' style); parse later if needed
    fuel              VARCHAR(32),
    collected_at      TIMESTAMPTZ  NOT NULL,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT sya_vehicle_motorizations_url_key
        UNIQUE (motorisation_url),
    CONSTRAINT sya_vehicle_motorizations_year_order
        CHECK (year_to IS NULL OR year_from IS NULL OR year_to >= year_from),
    CONSTRAINT sya_vehicle_motorizations_not_datelike
        CHECK (motorisation !~ '^\d{4}-\d{2}-\d{2}')        -- refuse re-ingesting date-coerced values
);

CREATE INDEX sya_vehicle_motorizations_model_idx
    ON sya_vehicle_motorizations (vehicle_model_id);

-- -----------------------------------------------------------------------------
-- 4. sya_product_vehicle_compatibility — one row per product + vehicle
--    fitment (expected 782). Verified in Stage 2: (product, model, generation,
--    motorisation, year_from, year_to) is already unique across all 782 rows;
--    category_url adds no identity and is kept as scrape provenance only.
--    NULLS NOT DISTINCT is required because year_to is NULL for in-production
--    vehicles and PostgreSQL would otherwise allow duplicate rows.
--    vehicle_motorization_id is resolved where the category_url motor id
--    matches a motorizations row; it is nullable so an unresolved link is
--    visible rather than silently dropped (0 expected unresolved).
-- -----------------------------------------------------------------------------
CREATE TABLE sya_product_vehicle_compatibility (
    id                        BIGSERIAL PRIMARY KEY,
    product_id                BIGINT      NOT NULL REFERENCES sya_products (id) ON DELETE CASCADE,
    vehicle_model_id          BIGINT      NOT NULL REFERENCES sya_vehicle_models (id),
    vehicle_motorization_id   BIGINT               REFERENCES sya_vehicle_motorizations (id),
    motorisation              VARCHAR(64) NOT NULL,          -- denormalized label (repaired value, never a date)
    year_from                 INTEGER,
    year_to                   INTEGER,                       -- NULL = still in production
    category_url              TEXT        NOT NULL,          -- provenance / evidence URL
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT sya_pvc_relationship_key
        UNIQUE NULLS NOT DISTINCT (product_id, vehicle_model_id, motorisation, year_from, year_to),
    CONSTRAINT sya_pvc_year_order
        CHECK (year_to IS NULL OR year_from IS NULL OR year_to >= year_from),
    CONSTRAINT sya_pvc_motorisation_not_datelike
        CHECK (motorisation !~ '^\d{4}-\d{2}-\d{2}')
);

CREATE INDEX sya_pvc_product_idx  ON sya_product_vehicle_compatibility (product_id);
CREATE INDEX sya_pvc_model_idx    ON sya_product_vehicle_compatibility (vehicle_model_id);
CREATE INDEX sya_pvc_motor_idx    ON sya_product_vehicle_compatibility (vehicle_motorization_id);

-- -----------------------------------------------------------------------------
-- 5. sya_product_images — one row per product/image (expected 311).
--    Source of truth is products.all_images_json (per Stage 2 decision;
--    the Sheets products_images / images tabs are NOT authoritative).
-- -----------------------------------------------------------------------------
CREATE TABLE sya_product_images (
    id              BIGSERIAL PRIMARY KEY,
    product_id      BIGINT      NOT NULL REFERENCES sya_products (id) ON DELETE CASCADE,
    image_url       TEXT        NOT NULL,
    image_alt       TEXT,
    image_filename  VARCHAR(255),
    position        SMALLINT    NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT sya_product_images_key
        UNIQUE (product_id, image_url),
    CONSTRAINT sya_product_images_position_positive
        CHECK (position >= 1),
    CONSTRAINT sya_product_images_url_shape
        CHECK (image_url ~ '^https://')
);

CREATE INDEX sya_product_images_product_idx ON sya_product_images (product_id);

-- -----------------------------------------------------------------------------
-- 6. Categories — DELIBERATELY NOT A TABLE in this stage.
--    The Sheets `categories` tab is a scraper crawl frontier (category ×
--    vehicle listing pages), not application data. The part category is
--    derivable from the product_url slug; if the storefront later needs a
--    browse tree, add a small sya_part_categories lookup + FK then, driven
--    by application need — not by reproducing the Sheets structure.
--
-- 7. DEFERRED PROPOSAL (documented only, DO NOT CREATE):
--    sya_product_price_history — justified: the source shows re-scrape runs,
--    and price/availability will drift between runs. Current price stays
--    denormalized on sya_products; history is appended per observation run.
--
--    CREATE TABLE sya_product_price_history (
--        id           BIGSERIAL PRIMARY KEY,
--        product_id   BIGINT       NOT NULL REFERENCES sya_products (id) ON DELETE CASCADE,
--        observed_at  TIMESTAMPTZ  NOT NULL,     -- last_checked_at of the scrape run
--        price_tnd    NUMERIC(8,2) NOT NULL CHECK (price_tnd > 0),
--        currency     CHAR(3)      NOT NULL DEFAULT 'TND',
--        availability VARCHAR(32)  NOT NULL,
--        source       VARCHAR(64)  NOT NULL,
--        CONSTRAINT sya_pph_observation_key UNIQUE (product_id, observed_at)
--    );
--
-- 8. Scraping metadata decision: collected_at / last_checked_at STAY on
--    sya_products. At 346 products a separate observation/snapshot table is
--    premature; sya_product_price_history (when authorised) is the
--    per-run record and covers the only field group that actually changes
--    between runs (price / availability / last_checked_at).
-- =============================================================================
