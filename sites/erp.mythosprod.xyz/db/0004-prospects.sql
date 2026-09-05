-- 0004-prospects.sql — Prospects module (Phase 8).
--
-- A prospect is a company or person not yet a client: tracked from first
-- contact to a decision, then CONVERTED into a client row (the conversion is
-- an API action, audited on both tables, never an UPDATE of the client table
-- by hand). Everything a tenant-scoped table needs is declared here so the
-- module cannot forget it: tenant_id, RLS, per-tenant uniqueness, updated_at
-- trigger, permissions, role grants, module key and erp_app grants.
--
-- Applied by api/migrations/migrate.js as erp_owner, after schema.sql,
-- schema-auth.sql and schema-tenant.sql. Idempotent where PostgreSQL allows it.
BEGIN;

CREATE TABLE IF NOT EXISTS prospects (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    legacy_id           text,
    name                text NOT NULL,
    contact_name        text,
    email               citext,
    phone               text,
    city                text,
    source              text,                      -- how they found us: referral, web, event, cold…
    status              text NOT NULL DEFAULT 'new',
    score               integer,                   -- 0..100, optional qualification score
    expected_value      numeric(14,3),             -- optional, in the tenant currency
    next_action_on      date,
    notes               text,
    converted_client_id uuid REFERENCES clients(id),
    converted_at        timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    deleted_at          timestamptz,
    CONSTRAINT prospect_status_known CHECK (status IN ('new','contacted','qualified','proposal','won','lost')),
    CONSTRAINT prospect_score_range  CHECK (score IS NULL OR (score BETWEEN 0 AND 100)),
    CONSTRAINT prospect_value_nonneg CHECK (expected_value IS NULL OR expected_value >= 0),
    -- won ⇔ converted: a prospect is won by becoming a client, not by a flag.
    CONSTRAINT prospect_conversion_consistent CHECK (
        (converted_client_id IS NULL AND converted_at IS NULL)
     OR (converted_client_id IS NOT NULL AND converted_at IS NOT NULL AND status = 'won'))
);

-- Per-tenant uniqueness, same rule as every re-scoped table in schema-tenant.sql.
CREATE UNIQUE INDEX IF NOT EXISTS prospects_tenant_legacy_key ON prospects (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL;
-- A client is converted from at most one prospect.
CREATE UNIQUE INDEX IF NOT EXISTS prospects_converted_client_key ON prospects (converted_client_id) WHERE converted_client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS prospects_tenant_idx  ON prospects (tenant_id);
CREATE INDEX IF NOT EXISTS prospects_status_idx  ON prospects (tenant_id, status);
CREATE INDEX IF NOT EXISTS prospects_next_idx    ON prospects (tenant_id, next_action_on);
CREATE INDEX IF NOT EXISTS prospects_name_trgm   ON prospects USING gin (name gin_trgm_ops);

DROP TRIGGER IF EXISTS prospects_set_updated_at ON prospects;
CREATE TRIGGER prospects_set_updated_at BEFORE UPDATE ON prospects
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Row-level security: identical policy to the other 25 tenant tables.
ALTER TABLE prospects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON prospects;
CREATE POLICY tenant_isolation ON prospects
    USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());

-- Module key: extend the closed vocabulary, then enable the module for every
-- existing tenant (a tenant may switch it off in Settings › Modules).
ALTER TABLE tenant_modules DROP CONSTRAINT IF EXISTS tenant_module_known;
ALTER TABLE tenant_modules ADD CONSTRAINT tenant_module_known CHECK (module_key IN (
    'dashboard','clients','prospects','projects','planning','production','finance',
    'invoices','documents','reports','inventory','settings','users','audit'));
INSERT INTO tenant_modules (tenant_id, module_key, enabled)
SELECT id, 'prospects', true FROM tenants
ON CONFLICT (tenant_id, module_key) DO NOTHING;

-- Permissions and role grants. convert is its own key: turning a prospect into
-- a client creates a client, which not every prospect editor may do.
INSERT INTO permissions (key, label) VALUES
  ('prospects.read','View prospects'), ('prospects.write','Create/edit prospects'),
  ('prospects.delete','Retire prospects'), ('prospects.convert','Convert a prospect into a client')
ON CONFLICT (key) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE (r.key = 'super_admin' AND p.key LIKE 'prospects.%')
   OR (r.key = 'admin'       AND p.key LIKE 'prospects.%')
   OR (r.key = 'manager'     AND p.key IN ('prospects.read','prospects.write','prospects.convert'))
   OR (r.key = 'read_only'   AND p.key = 'prospects.read')
ON CONFLICT DO NOTHING;

-- Application role: the same matrix as every other table (no DELETE: retirement
-- is deleted_at). Guarded so the file also applies to an instance where the
-- role is created afterwards (the drills create erp_app after the migrations).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') THEN
    GRANT SELECT, INSERT, UPDATE ON prospects TO erp_app;
  END IF;
END $$;

COMMIT;
