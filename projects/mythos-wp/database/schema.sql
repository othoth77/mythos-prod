-- =============================================================================
-- MYTHOS WP — Web Panel schema (database: mythos_wp, owner: mythos_wp_owner)
-- projects/mythos-wp/database/schema.sql
--
-- WHAT LIVES HERE AND WHAT DOES NOT
--   The automotive CATALOGUE (products, vehicles, motorizations, compatibility,
--   images) stays where it already is: the project's own database
--   (ssangyong.autos → `ssangyong_autos`, tables `sya_*`, schema
--   projects/ssangyong-autos/database/schema.sql). MYTHOS WP reads and writes
--   that catalogue through a per-project connection declared in wp_projects;
--   it never copies it. This database holds only what the panel itself owns:
--
--     wp_projects            registry of MYTHOS AUTO projects → their catalogue
--     wp_product_commercial  the VERIFIED commercial layer (selling price) per
--                            catalogue product — the only price the auto-reply
--                            may ever quote (the scraped catalogue price is a
--                            market observation, never a customer price)
--     wp_stock               the VERIFIED stock layer per catalogue product
--     wp_knowledge           customer-facing knowledge the auto-reply may use
--     wp_business_rules      per-project business configuration (JSON values)
--     wp_handoffs            REQUIRES_HUMAN queue fed by the auto-reply engine
--     wp_audit_events        who changed what, when (never a secret)
--
-- Design rules (repository convention, see ssangyong-autos/database/schema.sql):
--   BIGSERIAL PK; catalogue rows are referenced by their stable external id
--   `product_uid` (never the catalogue serial); TIMESTAMPTZ everywhere; no
--   secret-value columns; no customer PII (handoffs carry the masked number
--   the engine already produces: '***' + last three digits).
--
-- Apply (owner, once):  psql -U mythos_wp_owner -d mythos_wp -f schema.sql
-- Idempotent: every statement is IF NOT EXISTS so a re-run is a no-op.
-- =============================================================================

CREATE TABLE IF NOT EXISTS wp_projects (
    id               VARCHAR(64)  PRIMARY KEY,                 -- 'ssangyong-autos' (= comms project id)
    display_name     VARCHAR(128) NOT NULL,
    domain           VARCHAR(128),                             -- 'ssangyong.autos'
    brand_car        VARCHAR(64),                              -- 'SSANGYONG' (catalogue brand_car)
    catalog_dsn_env  VARCHAR(64)  NOT NULL,                    -- NAME of the env var holding the catalogue URL (never the value)
    catalog_schema   VARCHAR(64)  NOT NULL DEFAULT 'ssangyong_autos',
    currency         CHAR(3)      NOT NULL DEFAULT 'TND',
    status           VARCHAR(16)  NOT NULL DEFAULT 'active',
    notes            TEXT,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT wp_projects_id_shape      CHECK (id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    CONSTRAINT wp_projects_env_shape     CHECK (catalog_dsn_env ~ '^[A-Z][A-Z0-9_]{2,62}$'),
    CONSTRAINT wp_projects_schema_shape  CHECK (catalog_schema ~ '^[a-z_][a-z0-9_]{0,62}$'),
    CONSTRAINT wp_projects_currency_iso  CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT wp_projects_status_domain CHECK (status IN ('active', 'planned', 'archived'))
);

CREATE TABLE IF NOT EXISTS wp_product_commercial (
    id               BIGSERIAL    PRIMARY KEY,
    project_id       VARCHAR(64)  NOT NULL REFERENCES wp_projects (id),
    product_uid      VARCHAR(64)  NOT NULL,
    purchase_price   NUMERIC(10,2),
    selling_price    NUMERIC(10,2),                            -- NULL = no verified price → auto-reply says UNKNOWN
    currency         CHAR(3)      NOT NULL DEFAULT 'TND',
    price_note       TEXT,
    updated_by       VARCHAR(64),
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT wp_commercial_product_key    UNIQUE (project_id, product_uid),
    CONSTRAINT wp_commercial_purchase_pos   CHECK (purchase_price IS NULL OR purchase_price >= 0),
    CONSTRAINT wp_commercial_selling_pos    CHECK (selling_price IS NULL OR selling_price > 0),
    CONSTRAINT wp_commercial_currency_iso   CHECK (currency ~ '^[A-Z]{3}$')
);
CREATE INDEX IF NOT EXISTS wp_commercial_project_idx ON wp_product_commercial (project_id);

CREATE TABLE IF NOT EXISTS wp_stock (
    id               BIGSERIAL    PRIMARY KEY,
    project_id       VARCHAR(64)  NOT NULL REFERENCES wp_projects (id),
    product_uid      VARCHAR(64)  NOT NULL,
    quantity         INTEGER      NOT NULL DEFAULT 0,
    min_quantity     INTEGER      NOT NULL DEFAULT 0,
    availability     VARCHAR(16)  NOT NULL DEFAULT 'unknown',  -- in_stock | on_order | unavailable | unknown
    location         VARCHAR(128),
    lead_time_days   INTEGER,
    note             TEXT,
    updated_by       VARCHAR(64),
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT wp_stock_product_key        UNIQUE (project_id, product_uid),
    CONSTRAINT wp_stock_quantity_nonneg    CHECK (quantity >= 0),
    CONSTRAINT wp_stock_min_nonneg         CHECK (min_quantity >= 0),
    CONSTRAINT wp_stock_lead_nonneg        CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
    CONSTRAINT wp_stock_availability_domain CHECK (availability IN ('in_stock', 'on_order', 'unavailable', 'unknown'))
);
CREATE INDEX IF NOT EXISTS wp_stock_project_idx ON wp_stock (project_id);

CREATE TABLE IF NOT EXISTS wp_knowledge (
    id                     BIGSERIAL    PRIMARY KEY,
    project_id             VARCHAR(64)  NOT NULL REFERENCES wp_projects (id),
    product_uid            VARCHAR(64),                        -- NULL = project-wide knowledge
    kind                   VARCHAR(24)  NOT NULL DEFAULT 'faq', -- product_fact | faq | policy | vehicle_note
    title                  VARCHAR(200) NOT NULL,
    customer_text          TEXT         NOT NULL,              -- the text an automated reply may use verbatim
    language               CHAR(2)      NOT NULL DEFAULT 'fr',
    allowed_for_auto_reply BOOLEAN      NOT NULL DEFAULT false,
    status                 VARCHAR(16)  NOT NULL DEFAULT 'draft', -- draft | active | archived
    tags                   TEXT[]       NOT NULL DEFAULT '{}',
    updated_by             VARCHAR(64),
    created_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT wp_knowledge_kind_domain     CHECK (kind IN ('product_fact', 'faq', 'policy', 'vehicle_note')),
    CONSTRAINT wp_knowledge_language_domain CHECK (language IN ('fr', 'ar', 'en')),
    CONSTRAINT wp_knowledge_status_domain   CHECK (status IN ('draft', 'active', 'archived')),
    CONSTRAINT wp_knowledge_title_not_blank CHECK (length(trim(title)) > 0)
);
CREATE INDEX IF NOT EXISTS wp_knowledge_project_idx ON wp_knowledge (project_id, status);
CREATE INDEX IF NOT EXISTS wp_knowledge_product_idx ON wp_knowledge (product_uid);

CREATE TABLE IF NOT EXISTS wp_business_rules (
    id               BIGSERIAL    PRIMARY KEY,
    project_id       VARCHAR(64)  NOT NULL REFERENCES wp_projects (id),
    rule_key         VARCHAR(64)  NOT NULL,                    -- 'opening_hours', 'delivery_zones', …
    value_json       JSONB        NOT NULL DEFAULT '{}'::jsonb,
    description      TEXT,
    enabled          BOOLEAN      NOT NULL DEFAULT true,
    updated_by       VARCHAR(64),
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT wp_rules_key           UNIQUE (project_id, rule_key),
    CONSTRAINT wp_rules_key_shape     CHECK (rule_key ~ '^[a-z][a-z0-9_]{1,62}$')
);

CREATE TABLE IF NOT EXISTS wp_handoffs (
    id                   BIGSERIAL    PRIMARY KEY,
    project_id           VARCHAR(64)  NOT NULL REFERENCES wp_projects (id),
    event_id             VARCHAR(80),                          -- engine event id (a hash); idempotency key
    conversation_key     VARCHAR(64),                          -- sha256 prefix of (project, inbox, masked conversation)
    customer_ref_masked  VARCHAR(32),                          -- '***432' exactly as the engine records it
    channel              VARCHAR(24)  NOT NULL DEFAULT 'whatsapp',
    reason               VARCHAR(64)  NOT NULL,                -- REQUIRES_HUMAN | BUSINESS_DATA_UNAVAILABLE | …
    intent               VARCHAR(40),
    language             CHAR(2),
    entities             JSONB,                                -- what the customer wrote (model, year, part words, reference)
    facts                JSONB,                                -- { required, available, missing } fact NAMES
    related_product_uid  VARCHAR(64),
    suggested            JSONB,                                -- panel-side suggestions (matching products, knowledge)
    status               VARCHAR(16)  NOT NULL DEFAULT 'NEW',
    assigned_to          VARCHAR(64),
    notes                TEXT,
    resolution           TEXT,
    resolved_by          VARCHAR(64),
    resolved_at          TIMESTAMPTZ,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT wp_handoffs_event_key     UNIQUE (event_id),
    CONSTRAINT wp_handoffs_status_domain CHECK (status IN ('NEW', 'REQUIRES_HUMAN', 'IN_PROGRESS', 'RESOLVED')),
    CONSTRAINT wp_handoffs_language      CHECK (language IS NULL OR language IN ('fr', 'ar', 'en'))
);
CREATE INDEX IF NOT EXISTS wp_handoffs_queue_idx ON wp_handoffs (project_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS wp_audit_events (
    id               BIGSERIAL    PRIMARY KEY,
    at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    actor            VARCHAR(64)  NOT NULL,                    -- username, or 'system:<component>'
    actor_role       VARCHAR(16),
    action           VARCHAR(24)  NOT NULL,                    -- create | update | delete | login | login_failed | logout | status | setting
    resource         VARCHAR(64)  NOT NULL,                    -- resource key ('products', 'stock', 'session', …)
    record_id        VARCHAR(128),
    project_id       VARCHAR(64),
    changed_fields   TEXT[],
    previous         JSONB,                                    -- redacted before write; never a secret
    next             JSONB,
    request_id       VARCHAR(32),
    client           VARCHAR(64)                               -- socket address as seen by the service (nginx)
);
CREATE INDEX IF NOT EXISTS wp_audit_at_idx       ON wp_audit_events (at DESC);
CREATE INDEX IF NOT EXISTS wp_audit_record_idx   ON wp_audit_events (resource, record_id);
