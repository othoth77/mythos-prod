-- =============================================================================
-- MYTHOS OS — IDENTITY CORE (mythos_core)
--
-- STATUS: DRAFT — NOT DEPLOYED.
--
-- This file is a source definition only. Stage MYTHOS-IDENTITY-CORE-0 does NOT
-- execute it, does NOT provision a database, and does NOT migrate any existing
-- schema. No Mythos database currently hosts these tables.
--
-- Binding decision: docs/MYTHOS_IDENTITY_ARCHITECTURE.md
--   §2 canonical identifier   — prefixed UUIDv7 as text in VARCHAR(64)
--   §3 minimum model          — users, organizations, memberships + actor rule
--   §5 role vocabulary        — platform + organisation scopes
--   §7 non-scope              — what this stage deliberately does NOT build
--
-- Design rules applied throughout:
--   - [NO PII] No name, email, phone, or contact column anywhere. Profile data
--     belongs to the consuming product schema, never to identity core.
--   - No credential-bearing column of any kind. Credential storage is out of
--     scope for this stage (see §7).
--   - Canonical identifiers are opaque, prefixed, and non-enumerable so they
--     remain safe to expose across product boundaries.
--   - Consuming products hold these identifiers as opaque VARCHAR(64) values
--     with NO cross-schema foreign key, matching the pattern already documented
--     in every existing Mythos product schema.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. USERS — the canonical platform identity
--
--    user_pk is internal only and MUST NEVER be exposed across a product
--    boundary or written into an audit record. mythos_user_id is the sole
--    externally-visible identity value.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_users (
    user_pk         BIGSERIAL    PRIMARY KEY,
    mythos_user_id  VARCHAR(64)  NOT NULL UNIQUE,
        -- canonical form: usr_<uuidv7>
    status          VARCHAR(20)  NOT NULL DEFAULT 'active',
        -- active | suspended | deactivated
    platform_role   VARCHAR(30),
        -- NULL = ordinary user. Only 'mythos_super_admin' is defined.
    platform_role_granted_at  TIMESTAMPTZ,
    platform_role_granted_by  VARCHAR(64),
        -- mythos_user_id of the granter; full revocation history deferred
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- [NO PII]
    CONSTRAINT chk_mythos_user_id_format CHECK (
        mythos_user_id ~ '^usr_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ),
    CONSTRAINT chk_mythos_user_status CHECK (
        status IN ('active','suspended','deactivated')
    ),
    CONSTRAINT chk_mythos_platform_role CHECK (
        platform_role IS NULL OR platform_role = 'mythos_super_admin'
    )
);

COMMENT ON TABLE mythos_users IS
    'Canonical platform identity. No PII. mythos_user_id is the only value products may store.';


-- -----------------------------------------------------------------------------
-- 2. ORGANIZATIONS — the canonical subscriber organisation
--
--    Legal/tax/contact detail intentionally stays in the owning product schema
--    (for example idauto_organizations.tax_id). Identity core stores only what
--    every product must agree on: a stable identifier, a display name, a status.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_organizations (
    organization_pk  BIGSERIAL    PRIMARY KEY,
    organization_id  VARCHAR(64)  NOT NULL UNIQUE,
        -- canonical form: org_<uuidv7>
    display_name     VARCHAR(200) NOT NULL,
    status           VARCHAR(20)  NOT NULL DEFAULT 'pending',
        -- pending | active | suspended | cancelled
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- [NO PII]
    CONSTRAINT chk_mythos_org_id_format CHECK (
        organization_id ~ '^org_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ),
    CONSTRAINT chk_mythos_org_status CHECK (
        status IN ('pending','active','suspended','cancelled')
    )
);

COMMENT ON TABLE mythos_organizations IS
    'Canonical subscriber organisation. Legal/contact detail stays in the owning product schema.';


-- -----------------------------------------------------------------------------
-- 3. MEMBERSHIPS — user x organization x role
--
--    The role vocabulary and the (user, org) uniqueness rule are copied
--    verbatim from the LIVE idauto_user_roles constraints so that ID Auto's
--    existing semantics carry over without translation.
-- -----------------------------------------------------------------------------
CREATE TABLE mythos_memberships (
    membership_pk    BIGSERIAL    PRIMARY KEY,
    mythos_user_id   VARCHAR(64)  NOT NULL REFERENCES mythos_users(mythos_user_id),
    organization_id  VARCHAR(64)  NOT NULL REFERENCES mythos_organizations(organization_id),
    role             VARCHAR(30)  NOT NULL DEFAULT 'member',
        -- owner | admin | member | readonly
    status           VARCHAR(20)  NOT NULL DEFAULT 'active',
        -- active | suspended | revoked
    granted_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    granted_by       VARCHAR(64),
    revoked_at       TIMESTAMPTZ,
    revoked_by       VARCHAR(64),
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- [NO PII]
    CONSTRAINT chk_mythos_membership_role CHECK (
        role IN ('owner','admin','member','readonly')
    ),
    CONSTRAINT chk_mythos_membership_status CHECK (
        status IN ('active','suspended','revoked')
    ),
    CONSTRAINT uq_mythos_user_org UNIQUE (mythos_user_id, organization_id)
);

COMMENT ON TABLE mythos_memberships IS
    'User membership of an organisation with a single role. Role check only — no policy evaluation.';

CREATE INDEX idx_mythos_membership_user   ON mythos_memberships (mythos_user_id);
CREATE INDEX idx_mythos_membership_org    ON mythos_memberships (organization_id);
CREATE INDEX idx_mythos_membership_status ON mythos_memberships (status);


-- =============================================================================
-- ACTOR REFERENCE CONVENTION (contract, not a table)
--
--   Human user      actor_ref = usr_<uuidv7>
--                   actor_type IN ('contributor','professional_user','admin')
--   System/service  actor_ref = svc_<name>
--                   actor_type = 'system'
--   Unauthenticated actor_ref = NULL
--                   actor_type = 'anonymous'
--
--   actor_type vocabulary is adopted verbatim from the LIVE
--   idauto_audit_log CHECK constraint:
--     system | contributor | professional_user | admin | anonymous
--
--   RULE: actor_ref MUST NEVER contain a bearer credential, an email address,
--   or any personal data. It carries only a canonical usr_/svc_ identifier
--   or NULL. Products keep actor_ref as an opaque VARCHAR(64) and MUST NOT
--   add the format CHECK constraints above — those belong to mythos_core only,
--   so that products remain decoupled from core's internal validation.
-- =============================================================================
