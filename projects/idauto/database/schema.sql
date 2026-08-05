-- =============================================================================
-- ID Auto — Database Schema
-- Stage IDA-0 Foundation | 2026-08-05
-- Domain: idauto.tn
-- =============================================================================
--
-- PRIVACY CONTRACT
-- ----------------
-- This schema MUST NOT store, in any table queryable by plate number:
--   owner name, owner address, national ID (CIN), passport number,
--   phone, email, insurance policy number, insurer identity.
-- Any column that would hold PII must live in a separately-gated table
-- accessible only through the consent/legal-basis framework below.
-- PII columns are marked -- [NO PII] to make the absence explicit.
--
-- NAMESPACE
-- ---------
-- All tables are prefixed idauto_ to prevent collision with Mythos OS
-- mp_* tables. These schemas must live in separate databases or schemas.
--
-- COMPATIBILITY
-- -------------
-- Standard SQL (PostgreSQL-compatible). No engine-specific extensions
-- in this foundation file; IDA-1 will specify the target DBMS.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. PLATE FORMATS — configurable rules catalogue
-- -----------------------------------------------------------------------------
-- Mirrors config/idauto.example.json plate_formats array.
-- Populated from configuration; not from real registry data.

CREATE TABLE idauto_plate_formats (
    id             SERIAL PRIMARY KEY,
    code           VARCHAR(20)  NOT NULL UNIQUE,   -- e.g. TUN_STD
    name_fr        VARCHAR(100) NOT NULL,
    name_ar        VARCHAR(100),
    pattern        TEXT         NOT NULL,           -- POSIX regex
    example        VARCHAR(30),
    introduced_year INTEGER,
    active         BOOLEAN      NOT NULL DEFAULT TRUE,
    captures_json  TEXT,                            -- JSON capture-group semantics
    notes          TEXT,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE idauto_plate_formats IS
    'Configurable plate format rules. Updated from config, not from registry data.';


-- -----------------------------------------------------------------------------
-- 2. GOVERNORATES — reference lookup
-- -----------------------------------------------------------------------------

CREATE TABLE idauto_governorates (
    id             SERIAL PRIMARY KEY,
    code           VARCHAR(4)   NOT NULL UNIQUE,   -- e.g. 01, 34
    name_fr        VARCHAR(80)  NOT NULL,
    name_ar        VARCHAR(80),
    region_fr      VARCHAR(80),
    active         BOOLEAN      NOT NULL DEFAULT TRUE
);

COMMENT ON TABLE idauto_governorates IS
    'Tunisian governorate reference. Source: official administrative division.';


-- -----------------------------------------------------------------------------
-- 3. VEHICLE ATTRIBUTES — public record (no PII)
-- -----------------------------------------------------------------------------
-- Represents the vehicle as a physical object, not its owner.
-- A vehicle row may be created from official gazette records or from
-- data published by the traffic authority under public registry rules.
-- [NO PII] — owner identity is never stored in this table.

CREATE TABLE idauto_vehicles (
    id             SERIAL PRIMARY KEY,
    internal_ref   VARCHAR(40)  NOT NULL UNIQUE,   -- stable internal key (not plate)
    make           VARCHAR(80),                    -- e.g. Peugeot, Volkswagen
    model          VARCHAR(80),                    -- e.g. 208, Passat
    variant        VARCHAR(80),                    -- e.g. 1.6 HDi, TDI
    year           INTEGER,                        -- manufacture year
    body_type      VARCHAR(40),                    -- berline, utilitaire, SUV, moto, …
    fuel_type      VARCHAR(20),                    -- essence, diesel, électrique, hybride
    colour         VARCHAR(40),
    seats          SMALLINT,
    gross_weight_kg INTEGER,
    engine_cc      INTEGER,
    category_code  VARCHAR(10),                    -- M1, N1, L3, … (EU vehicle category)
    source_id      INTEGER,                        -- FK → idauto_sources
    -- [NO PII] owner fields deliberately absent
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE idauto_vehicles IS
    'Vehicle physical attributes. NO owner PII. source_id tracks data provenance.';

CREATE INDEX idx_idauto_vehicles_make_model ON idauto_vehicles (make, model);
CREATE INDEX idx_idauto_vehicles_year       ON idauto_vehicles (year);


-- -----------------------------------------------------------------------------
-- 4. PLATES — registration records (no PII)
-- -----------------------------------------------------------------------------
-- Represents a plate registration. A vehicle may have multiple plates
-- over its lifetime (stolen, re-registered, etc.).
-- [NO PII] — owner identity is never stored in this table.

CREATE TABLE idauto_plates (
    id              SERIAL PRIMARY KEY,
    plate_number    VARCHAR(20)  NOT NULL,          -- normalised: uppercase, no extra spaces
    plate_raw       VARCHAR(30),                    -- original casing if different
    format_code     VARCHAR(20)  NOT NULL REFERENCES idauto_plate_formats(code),
    governorate_id  INTEGER      REFERENCES idauto_governorates(id),
    vehicle_id      INTEGER      REFERENCES idauto_vehicles(id),
    status          VARCHAR(20)  NOT NULL DEFAULT 'active',
        -- active | suspended | cancelled | exported | stolen
    valid_from      DATE,
    valid_until     DATE,                           -- NULL = indefinite
    source_id       INTEGER,                        -- FK → idauto_sources
    -- [NO PII] owner fields deliberately absent
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_plates_status CHECK (
        status IN ('active','suspended','cancelled','exported','stolen','unknown')
    )
);

COMMENT ON TABLE idauto_plates IS
    'Plate registration records. NO owner PII. One plate per row; '
    'vehicle may have multiple plate rows across its history.';

CREATE UNIQUE INDEX uidx_idauto_plates_number_active
    ON idauto_plates (plate_number)
    WHERE status = 'active';

CREATE INDEX idx_idauto_plates_vehicle    ON idauto_plates (vehicle_id);
CREATE INDEX idx_idauto_plates_format     ON idauto_plates (format_code);
CREATE INDEX idx_idauto_plates_status     ON idauto_plates (status);


-- -----------------------------------------------------------------------------
-- 5. SOURCES — data provenance catalogue
-- -----------------------------------------------------------------------------
-- Every row in vehicles/plates traces to a source. This supports
-- data-quality decisions and legal-basis claims in IDA-1.

CREATE TABLE idauto_sources (
    id              SERIAL PRIMARY KEY,
    code            VARCHAR(40)  NOT NULL UNIQUE,
    name_fr         VARCHAR(100) NOT NULL,
    name_ar         VARCHAR(100),
    source_type     VARCHAR(30)  NOT NULL,
        -- official_gazette | traffic_authority | professional_report | manual | import
    legal_basis     VARCHAR(60),                    -- e.g. organic_law_63_2004_art_12
    url             TEXT,
    contact         TEXT,
    active          BOOLEAN      NOT NULL DEFAULT TRUE,
    notes           TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_sources_type CHECK (
        source_type IN ('official_gazette','traffic_authority','professional_report','manual','import','test')
    )
);

COMMENT ON TABLE idauto_sources IS
    'Data provenance catalogue. Every vehicle/plate row references a source.';

ALTER TABLE idauto_vehicles ADD CONSTRAINT fk_vehicles_source
    FOREIGN KEY (source_id) REFERENCES idauto_sources(id);

ALTER TABLE idauto_plates ADD CONSTRAINT fk_plates_source
    FOREIGN KEY (source_id) REFERENCES idauto_sources(id);


-- -----------------------------------------------------------------------------
-- 6. VERIFICATIONS — plate lookup events (audit trail)
-- -----------------------------------------------------------------------------
-- Every public or professional plate search generates a verification row.
-- This is the primary rate-limiting and abuse-detection table.
-- The queried plate and result summary are stored; no PII is stored here
-- even if the lookup produced a match.

CREATE TABLE idauto_verifications (
    id              BIGSERIAL    PRIMARY KEY,
    plate_queried   VARCHAR(30)  NOT NULL,          -- exactly as submitted by caller
    plate_normalised VARCHAR(20),                   -- after normalisation
    result_status   VARCHAR(20)  NOT NULL,
        -- found | not_found | invalid_format | rate_limited | error
    format_code     VARCHAR(20),                    -- matched format or NULL
    vehicle_id      INTEGER      REFERENCES idauto_vehicles(id),
    caller_type     VARCHAR(20)  NOT NULL DEFAULT 'anonymous',
        -- anonymous | authenticated | professional
    org_id          INTEGER,                        -- FK → idauto_organizations (professional callers)
    user_role_id    INTEGER,                        -- FK → idauto_user_roles
    ip_hash         VARCHAR(64),                    -- SHA-256 of caller IP; not the raw IP
    user_agent_hash VARCHAR(64),                    -- SHA-256 of User-Agent
    response_ms     INTEGER,                        -- response time in milliseconds
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- [NO PII] raw IP, full user agent, owner data deliberately absent
    CONSTRAINT chk_verif_result CHECK (
        result_status IN ('found','not_found','invalid_format','rate_limited','error','blocked')
    ),
    CONSTRAINT chk_verif_caller CHECK (
        caller_type IN ('anonymous','authenticated','professional')
    )
);

COMMENT ON TABLE idauto_verifications IS
    'Every plate search event. Rate-limiting source. '
    'IP stored only as SHA-256 hash; no raw PII.';

CREATE INDEX idx_idauto_verif_plate     ON idauto_verifications (plate_normalised);
CREATE INDEX idx_idauto_verif_org       ON idauto_verifications (org_id);
CREATE INDEX idx_idauto_verif_created   ON idauto_verifications (created_at);
CREATE INDEX idx_idauto_verif_caller    ON idauto_verifications (caller_type, created_at);


-- -----------------------------------------------------------------------------
-- 7. ORGANIZATIONS — professional subscriber entities
-- -----------------------------------------------------------------------------

CREATE TABLE idauto_organizations (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(200) NOT NULL,
    org_type        VARCHAR(30)  NOT NULL,
        -- garage | insurer | fleet | judicial | other
    subscription_tier VARCHAR(20) NOT NULL DEFAULT 'GARAGE',
    tax_id          VARCHAR(30),                    -- Matricule fiscal (not PII — entity ID)
    address_city    VARCHAR(80),
    governorate_id  INTEGER      REFERENCES idauto_governorates(id),
    contact_email   VARCHAR(200),                   -- organisational contact, not personal
    status          VARCHAR(20)  NOT NULL DEFAULT 'pending',
        -- pending | active | suspended | cancelled
    verified_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_org_type CHECK (
        org_type IN ('garage','insurer','fleet','judicial','government','other')
    ),
    CONSTRAINT chk_org_status CHECK (
        status IN ('pending','active','suspended','cancelled')
    )
);

COMMENT ON TABLE idauto_organizations IS
    'Professional subscriber organizations. tax_id is entity identifier, not personal.';

ALTER TABLE idauto_verifications ADD CONSTRAINT fk_verif_org
    FOREIGN KEY (org_id) REFERENCES idauto_organizations(id);


-- -----------------------------------------------------------------------------
-- 8. USER ROLES — professional user accounts linked to organizations
-- -----------------------------------------------------------------------------
-- User identity is managed by Mythos OS auth service.
-- This table holds only the role assignment and org linkage.
-- Raw PII (name, email, phone) is never duplicated here; use the
-- Mythos OS user record via the auth integration contract.

CREATE TABLE idauto_user_roles (
    id              SERIAL PRIMARY KEY,
    mythos_user_id  VARCHAR(64)  NOT NULL,          -- opaque reference to Mythos OS user
    org_id          INTEGER      NOT NULL REFERENCES idauto_organizations(id),
    role            VARCHAR(30)  NOT NULL DEFAULT 'member',
        -- owner | admin | member | readonly
    status          VARCHAR(20)  NOT NULL DEFAULT 'active',
        -- active | suspended | revoked
    granted_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    granted_by      VARCHAR(64),                    -- mythos_user_id of granter
    revoked_at      TIMESTAMPTZ,
    revoked_by      VARCHAR(64),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- [NO PII] name/email not stored; resolved from Mythos OS auth at runtime
    CONSTRAINT chk_user_role     CHECK (role   IN ('owner','admin','member','readonly')),
    CONSTRAINT chk_user_status   CHECK (status IN ('active','suspended','revoked')),
    CONSTRAINT uq_user_org       UNIQUE (mythos_user_id, org_id)
);

COMMENT ON TABLE idauto_user_roles IS
    'Role assignments for professional users. Identity resolved from Mythos OS auth. '
    'No raw PII duplicated here.';

ALTER TABLE idauto_verifications ADD CONSTRAINT fk_verif_user_role
    FOREIGN KEY (user_role_id) REFERENCES idauto_user_roles(id);


-- -----------------------------------------------------------------------------
-- 9. SERVICE EVENTS — professional annotations on vehicle history
-- -----------------------------------------------------------------------------
-- Written by verified professional organizations (garages, etc.).
-- Contains technical service records; never contains owner PII.

CREATE TABLE idauto_service_events (
    id              BIGSERIAL    PRIMARY KEY,
    vehicle_id      INTEGER      NOT NULL REFERENCES idauto_vehicles(id),
    plate_id        INTEGER      REFERENCES idauto_plates(id),
    org_id          INTEGER      NOT NULL REFERENCES idauto_organizations(id),
    user_role_id    INTEGER      NOT NULL REFERENCES idauto_user_roles(id),
    event_type      VARCHAR(40)  NOT NULL,
        -- inspection | repair | oil_change | tyre | bodywork | electrical |
        -- recall | accident_declaration | technical_control | other
    event_date      DATE         NOT NULL,
    odometer_km     INTEGER,
    description     TEXT,
    outcome         VARCHAR(30),
        -- pass | fail | conditional | informational
    next_service_due DATE,
    is_public       BOOLEAN      NOT NULL DEFAULT FALSE,
        -- FALSE: visible only to writing org; TRUE: visible to all professional subscribers
    -- [NO PII] customer name/contact deliberately absent
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_event_type CHECK (
        event_type IN (
            'inspection','repair','oil_change','tyre','bodywork','electrical',
            'recall','accident_declaration','technical_control','other'
        )
    ),
    CONSTRAINT chk_event_outcome CHECK (
        outcome IN ('pass','fail','conditional','informational') OR outcome IS NULL
    )
);

COMMENT ON TABLE idauto_service_events IS
    'Professional service history annotations. NO customer PII. '
    'Visibility controlled by is_public flag.';

CREATE INDEX idx_idauto_svc_vehicle  ON idauto_service_events (vehicle_id);
CREATE INDEX idx_idauto_svc_org      ON idauto_service_events (org_id);
CREATE INDEX idx_idauto_svc_date     ON idauto_service_events (event_date);
CREATE INDEX idx_idauto_svc_type     ON idauto_service_events (event_type);


-- -----------------------------------------------------------------------------
-- 10. CONSENT AND LEGAL BASIS — data-processing justification records
-- -----------------------------------------------------------------------------
-- Required for GDPR-adjacent compliance and Tunisian personal data law.
-- Each category of data processing must have a declared legal basis.
-- For ID Auto's public data, this is typically "legitimate interest"
-- or "public registry data"; for professional subscriber data processing,
-- this is "contractual necessity" plus explicit consent.

CREATE TABLE idauto_consent_records (
    id              BIGSERIAL    PRIMARY KEY,
    subject_type    VARCHAR(30)  NOT NULL,
        -- organization | user_role | anonymous_session
    subject_ref     VARCHAR(64)  NOT NULL,          -- org id, user_role id, or session token hash
    processing_purpose VARCHAR(60) NOT NULL,
        -- plate_lookup | service_event_write | service_event_read |
        -- subscription_billing | marketing | analytics
    legal_basis     VARCHAR(60)  NOT NULL,
        -- legitimate_interest | contract | legal_obligation | vital_interest |
        -- public_task | explicit_consent
    consent_given   BOOLEAN,                        -- NULL = not consent-based basis
    consent_version VARCHAR(20),                    -- policy version at time of consent
    ip_hash         VARCHAR(64),                    -- SHA-256 of IP at consent time
    granted_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    withdrawn_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    notes           TEXT,
    CONSTRAINT chk_consent_subject CHECK (
        subject_type IN ('organization','user_role','anonymous_session')
    ),
    CONSTRAINT chk_consent_purpose CHECK (
        processing_purpose IN (
            'plate_lookup','service_event_write','service_event_read',
            'subscription_billing','marketing','analytics','account_management'
        )
    ),
    CONSTRAINT chk_consent_basis CHECK (
        legal_basis IN (
            'legitimate_interest','contract','legal_obligation',
            'vital_interest','public_task','explicit_consent'
        )
    )
);

COMMENT ON TABLE idauto_consent_records IS
    'Legal basis and consent records for all data-processing activities. '
    'Required for Tunisian organic law 63-2004 compliance.';

CREATE INDEX idx_idauto_consent_subject  ON idauto_consent_records (subject_type, subject_ref);
CREATE INDEX idx_idauto_consent_purpose  ON idauto_consent_records (processing_purpose);
CREATE INDEX idx_idauto_consent_active   ON idauto_consent_records (withdrawn_at) WHERE withdrawn_at IS NULL;


-- -----------------------------------------------------------------------------
-- 11. AUDIT LOG — immutable event record
-- -----------------------------------------------------------------------------
-- Append-only log of all state-changing events in the ID Auto system.
-- No row is ever deleted or updated; corrections are new rows.
-- Complements idauto_verifications (which is lookup-specific).

CREATE TABLE idauto_audit_log (
    id              BIGSERIAL    PRIMARY KEY,
    event_time      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    event_type      VARCHAR(60)  NOT NULL,
        -- plate.lookup | plate.create | plate.update | plate.status_change |
        -- vehicle.create | vehicle.update | org.create | org.status_change |
        -- user_role.grant | user_role.revoke | service_event.create |
        -- consent.grant | consent.withdraw | config.change | admin.action
    actor_type      VARCHAR(20)  NOT NULL,
        -- system | professional_user | admin | anonymous
    actor_ref       VARCHAR(64),                    -- mythos_user_id or system identifier
    org_id          INTEGER,                        -- FK → organizations if applicable
    target_type     VARCHAR(40),                    -- plate | vehicle | org | user_role | ...
    target_ref      VARCHAR(64),                    -- target row id as text
    change_summary  TEXT,                           -- human-readable one-line description
    old_value_json  TEXT,                           -- JSON snapshot before change (no PII)
    new_value_json  TEXT,                           -- JSON snapshot after change (no PII)
    ip_hash         VARCHAR(64),                    -- SHA-256 of actor IP
    request_id      VARCHAR(64),                    -- correlation ID for request tracing
    -- [NO PII] raw IP, name, address, owner fields deliberately absent
    CONSTRAINT chk_audit_actor CHECK (
        actor_type IN ('system','professional_user','admin','anonymous')
    )
);

COMMENT ON TABLE idauto_audit_log IS
    'Immutable append-only audit trail. No row is ever updated or deleted. '
    'No raw PII in any column.';

CREATE INDEX idx_idauto_audit_time    ON idauto_audit_log (event_time);
CREATE INDEX idx_idauto_audit_type    ON idauto_audit_log (event_type);
CREATE INDEX idx_idauto_audit_actor   ON idauto_audit_log (actor_ref);
CREATE INDEX idx_idauto_audit_target  ON idauto_audit_log (target_type, target_ref);
CREATE INDEX idx_idauto_audit_org     ON idauto_audit_log (org_id);


-- =============================================================================
-- SEED: plate format catalogue (from config/idauto.example.json)
-- Safe to run in development; never runs against production until IDA-2.
-- =============================================================================

INSERT INTO idauto_plate_formats (code, name_fr, name_ar, pattern, example, introduced_year, active, notes)
VALUES
    ('TUN_STD', 'Plaque standard (série courante)', 'لوحة قياسية',
     '^\d{1,3}\s?TUN\s?\d{1,4}$', '123 TUN 4567', 2002, TRUE,
     'Main passenger series. Left: batch prefix. Right: sequential within batch.'),
    ('TUN_OLD', 'Plaque ancienne (avant 2002)', 'لوحة قديمة',
     '^\d{1,4}\s?TUN\s?\d{1,2}$', '1234 TUN 56', NULL, FALSE,
     'Pre-2002 series still in circulation. Right two digits: legacy governorate code.'),
    ('TUN_GVT', 'Véhicule gouvernemental', 'مركبة حكومية',
     '^GN\s?\d{1,3}\s?\d{1,3}$', 'GN 123 456', NULL, TRUE,
     'Ministries and public institutions.'),
    ('TUN_DIP', 'Corps diplomatique', 'سلك دبلوماسي',
     '^CD\s?\d{1,2}\s?\d{1,3}$', 'CD 12 345', NULL, TRUE,
     'Diplomatic corps. Public response returns vehicle category only.'),
    ('TUN_MIL', 'Forces armées', 'القوات المسلحة',
     '^ARN\s?\d{1,6}$', 'ARN 123456', NULL, TRUE,
     'Military vehicles. Public lookup returns vehicle type only.'),
    ('TUN_TMP', 'Immatriculation temporaire / transit', 'ترخيص مؤقت',
     '^TT\s?\d{1,5}\s?[A-Z]$', 'TT 12345 A', NULL, TRUE,
     'Short-term and transit registration.'),
    ('TUN_ECO', 'Zone économique / spéciale', 'منطقة اقتصادية',
     '^ZE\s?\d{1,4}\s?\d{1,3}$', 'ZE 1234 567', NULL, TRUE,
     'Free-trade and industrial zone vehicles.');

INSERT INTO idauto_governorates (code, name_fr, name_ar, region_fr) VALUES
    ('01','Tunis','تونس','Grand Tunis'),
    ('02','Ariana','أريانة','Grand Tunis'),
    ('03','Ben Arous','بن عروس','Grand Tunis'),
    ('04','Manouba','منوبة','Grand Tunis'),
    ('11','Bizerte','بنزرت','Nord'),
    ('12','Nabeul','نابل','Nord-Est'),
    ('13','Zaghouan','زغوان','Nord-Est'),
    ('21','Béja','باجة','Nord-Ouest'),
    ('22','Jendouba','جندوبة','Nord-Ouest'),
    ('23','Kef','الكاف','Nord-Ouest'),
    ('24','Siliana','سليانة','Nord-Ouest'),
    ('31','Sousse','سوسة','Centre-Est'),
    ('32','Monastir','المنستير','Centre-Est'),
    ('33','Mahdia','المهدية','Centre-Est'),
    ('34','Sfax','صفاقس','Centre-Est'),
    ('41','Kairouan','القيروان','Centre'),
    ('42','Kasserine','القصرين','Centre-Ouest'),
    ('43','Sidi Bouzid','سيدي بوزيد','Centre'),
    ('51','Gabès','قابس','Sud-Est'),
    ('52','Médenine','مدنين','Sud-Est'),
    ('53','Tataouine','تطاوين','Sud-Est'),
    ('61','Gafsa','قفصة','Sud-Ouest'),
    ('62','Tozeur','توزر','Sud-Ouest'),
    ('63','Kébili','قبلي','Sud-Ouest');

INSERT INTO idauto_sources (code, name_fr, name_ar, source_type, legal_basis, notes)
VALUES
    ('TEST_ONLY', 'Données de test — aucune donnée réelle', 'بيانات اختبار فقط',
     'test', NULL,
     'IDA-0 foundation seed. No real vehicle or owner data. Never use in production.');

-- =============================================================================
-- END OF SCHEMA — IDA-0 Foundation
-- =============================================================================
