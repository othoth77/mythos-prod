-- MYTHOS WP — migration 0004: multi-service foundation (MYTHOS-COMMS-8, #217)
-- A project is a service (tenant). Non-automotive services carry no catalogue.
ALTER TABLE wp_projects ADD COLUMN IF NOT EXISTS kind VARCHAR(16) NOT NULL DEFAULT 'automotive';
ALTER TABLE wp_projects DROP CONSTRAINT IF EXISTS wp_projects_kind_domain;
ALTER TABLE wp_projects ADD CONSTRAINT wp_projects_kind_domain CHECK (kind IN ('automotive', 'service', 'internal'));
ALTER TABLE wp_projects ALTER COLUMN catalog_dsn_env DROP NOT NULL;
ALTER TABLE wp_projects ALTER COLUMN catalog_schema DROP NOT NULL;
ALTER TABLE wp_projects ALTER COLUMN catalog_schema DROP DEFAULT;
ALTER TABLE wp_projects DROP CONSTRAINT IF EXISTS wp_projects_env_shape;
ALTER TABLE wp_projects ADD CONSTRAINT wp_projects_env_shape CHECK (catalog_dsn_env IS NULL OR catalog_dsn_env ~ '^[A-Z][A-Z0-9_]{2,62}$');
ALTER TABLE wp_projects DROP CONSTRAINT IF EXISTS wp_projects_schema_shape;
ALTER TABLE wp_projects ADD CONSTRAINT wp_projects_schema_shape CHECK (catalog_schema IS NULL OR catalog_schema ~ '^[a-z_][a-z0-9_]{0,62}$');
ALTER TABLE wp_projects DROP CONSTRAINT IF EXISTS wp_projects_catalog_required;
ALTER TABLE wp_projects ADD CONSTRAINT wp_projects_catalog_required CHECK (kind <> 'automotive' OR (catalog_dsn_env IS NOT NULL AND catalog_schema IS NOT NULL));

-- Which WhatsApp account an inbox is linked to (digits; NOT a secret, it is the
-- business number customers write to). Detects sharing and protects the
-- notification channel's account.
ALTER TABLE wp_inboxes ADD COLUMN IF NOT EXISTS account_ref VARCHAR(32);
ALTER TABLE wp_inboxes DROP CONSTRAINT IF EXISTS wp_inboxes_account_ref_shape;
ALTER TABLE wp_inboxes ADD CONSTRAINT wp_inboxes_account_ref_shape CHECK (account_ref IS NULL OR account_ref ~ '^[0-9]{6,32}$');
-- one account = one inbox, unless that inbox explicitly opts into sharing (settings.allow_personal_account = true)
CREATE UNIQUE INDEX IF NOT EXISTS wp_inboxes_account_uidx ON wp_inboxes (account_ref)
    WHERE account_ref IS NOT NULL AND COALESCE((settings->>'allow_personal_account')::boolean, false) = false;

-- Accounts no inbox may ever claim (the MYTHOS notification account). Data, owner-managed.
CREATE TABLE IF NOT EXISTS wp_reserved_accounts (
    account_ref  VARCHAR(32) PRIMARY KEY,
    reason       VARCHAR(120) NOT NULL DEFAULT 'notification channel',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wp_reserved_accounts_shape CHECK (account_ref ~ '^[0-9]{6,32}$')
);
CREATE OR REPLACE FUNCTION wp_inboxes_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.account_ref IS NOT NULL AND EXISTS (SELECT 1 FROM wp_reserved_accounts r WHERE r.account_ref = NEW.account_ref) THEN
    RAISE EXCEPTION 'account is reserved for the MYTHOS notification channel' USING ERRCODE = '23514', CONSTRAINT = 'wp_inboxes_account_reserved';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS wp_inboxes_guard_trg ON wp_inboxes;
CREATE TRIGGER wp_inboxes_guard_trg BEFORE INSERT OR UPDATE OF account_ref ON wp_inboxes FOR EACH ROW EXECUTE FUNCTION wp_inboxes_guard();

-- Agents per inbox (visibility scope). A user with at least one membership sees only member inboxes.
CREATE TABLE IF NOT EXISTS wp_inbox_members (
    id           BIGSERIAL    PRIMARY KEY,
    inbox_id     BIGINT       NOT NULL REFERENCES wp_inboxes (id) ON DELETE CASCADE,
    username     VARCHAR(64)  NOT NULL,
    role         VARCHAR(12)  NOT NULL DEFAULT 'agent',          -- agent | lead | viewer
    team         VARCHAR(64),
    added_by     VARCHAR(64)  NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT wp_inbox_members_unique      UNIQUE (inbox_id, username),
    CONSTRAINT wp_inbox_members_role_domain CHECK (role IN ('agent', 'lead', 'viewer')),
    CONSTRAINT wp_inbox_members_user_shape  CHECK (username ~ '^[a-z0-9][a-z0-9._-]{1,63}$')
);
CREATE INDEX IF NOT EXISTS wp_inbox_members_user_idx ON wp_inbox_members (username);
INSERT INTO wp_schema_migrations (version) VALUES ('0004_multiservice') ON CONFLICT (version) DO NOTHING;
