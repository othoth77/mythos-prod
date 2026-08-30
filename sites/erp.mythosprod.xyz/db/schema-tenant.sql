-- Mythos ERP — multi-tenancy (migration 003)
--
-- Turns the single-tenant schema of 001/002 into one ERP engine serving many
-- companies. Applied before any database exists, deliberately: retrofitting
-- tenancy onto a populated ERP means rewriting every table and every unique
-- constraint while real invoices are in it.
--
-- Isolation is enforced by PostgreSQL Row-Level Security, not by remembering a
-- WHERE clause. See docs/ERP_MULTI_TENANT_ARCHITECTURE.md for why.

BEGIN;

-- ── Tenants ─────────────────────────────────────────────────────────────────
-- Everything a company can customise lives here. Mythos Prod is a ROW, not a
-- special case in the code: if deleting that row broke the ERP, this would be
-- a product with extra tables rather than an engine.
CREATE TABLE tenants (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key             citext NOT NULL UNIQUE,        -- url-safe handle, e.g. 'mythos'
    display_name    text NOT NULL,
    legal_name      text,
    status          text NOT NULL DEFAULT 'active',
    -- Branding. No Mythos default: an unbranded tenant renders the neutral
    -- design-system palette, which is the engine's, not a customer's.
    logo_storage_key text,
    brand_primary   text,                          -- '#rrggbb', validated by the app
    brand_accent    text,
    locale          text NOT NULL DEFAULT 'fr-TN',
    timezone        text NOT NULL DEFAULT 'Africa/Tunis',
    currency        char(3) NOT NULL DEFAULT 'TND',
    -- Invoice identity and numbering, per company.
    invoice_prefix  text NOT NULL DEFAULT '',
    invoice_pattern text NOT NULL DEFAULT '{prefix}{year}-{seq:4}',
    invoice_next_seq integer NOT NULL DEFAULT 1,
    tax_identifier  text,                          -- matricule fiscal
    address         text,
    settings        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz,
    CONSTRAINT tenants_status_known CHECK (status IN ('active','suspended','archived')),
    CONSTRAINT tenants_seq_positive CHECK (invoice_next_seq >= 1)
);

-- ── Per-tenant module enablement ────────────────────────────────────────────
-- Enforced at the API boundary: a disabled module 404s every route beneath it.
-- Hiding a nav item is presentation; the refusal is the control.
CREATE TABLE tenant_modules (
    tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    module_key  text NOT NULL,
    enabled     boolean NOT NULL DEFAULT true,
    PRIMARY KEY (tenant_id, module_key),
    CONSTRAINT tenant_module_known CHECK (module_key IN (
        'dashboard','clients','projects','planning','production','finance',
        'invoices','documents','reports','inventory','settings','users','audit'))
);

-- ── Membership: the user↔tenant join ────────────────────────────────────────
-- One person, many companies. This is the row that makes central identity
-- possible without the ERP owning the identity platform.
CREATE TABLE tenant_memberships (
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    status      text NOT NULL DEFAULT 'active',
    is_default  boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, tenant_id),
    CONSTRAINT membership_status_known CHECK (status IN ('active','suspended'))
);
CREATE INDEX tenant_memberships_tenant_idx ON tenant_memberships (tenant_id);

-- ── Identity: ready for an external provider, not dependent on one ─────────
ALTER TABLE users
  ADD COLUMN identity_source text NOT NULL DEFAULT 'local',
  ADD COLUMN external_subject text,
  ADD CONSTRAINT users_identity_source_known
      CHECK (identity_source IN ('local','mythos_id')),
  -- A local account must have a password; a federated one must not need it.
  ADD CONSTRAINT users_external_subject_shape
      CHECK (identity_source = 'local' OR external_subject IS NOT NULL);
CREATE UNIQUE INDEX users_external_subject_key
  ON users (external_subject) WHERE external_subject IS NOT NULL;

-- A session is authenticated globally and ACTS inside one tenant at a time.
ALTER TABLE sessions
  ADD COLUMN active_tenant_id uuid REFERENCES tenants(id);

-- ── Roles become tenant-scoped ──────────────────────────────────────────────
-- A user may administer Company A and be read-only in Company B. A global
-- user_roles cannot express that, so the grant carries the tenant.
ALTER TABLE user_roles
  ADD COLUMN tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE user_roles DROP CONSTRAINT user_roles_pkey;
ALTER TABLE user_roles ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE user_roles ADD PRIMARY KEY (user_id, tenant_id, role_id);
CREATE INDEX user_roles_tenant_idx ON user_roles (tenant_id);

-- The effective-permission view must resolve per (user, tenant), or a grant in
-- one company would authorise an action in another.
DROP VIEW IF EXISTS user_effective_permissions;
CREATE VIEW user_effective_permissions AS
SELECT ur.user_id,
       ur.tenant_id,
       p.key AS permission_key
FROM user_roles ur
JOIN users u            ON u.id = ur.user_id
JOIN tenant_memberships tm ON tm.user_id = ur.user_id AND tm.tenant_id = ur.tenant_id
JOIN tenants t          ON t.id = ur.tenant_id
JOIN role_permissions rp ON rp.role_id = ur.role_id
JOIN permissions p       ON p.id = rp.permission_id
WHERE u.is_active
  AND u.deleted_at IS NULL
  AND tm.status = 'active'
  AND t.status = 'active'
  AND t.deleted_at IS NULL;

-- ── Audit log carries its tenant ────────────────────────────────────────────
-- Nullable on purpose: a login happens before a tenant is chosen, and those
-- platform events legitimately have none.
ALTER TABLE audit_log ADD COLUMN tenant_id uuid REFERENCES tenants(id);
CREATE INDEX audit_log_tenant_idx ON audit_log (tenant_id, occurred_at DESC);

-- ── tenant_id on every business table ───────────────────────────────────────
DO $$
DECLARE
  t text;
  business text[] := ARRAY[
    'natures','expense_categories','clients','contacts','suppliers',
    'collaborators','projects','contracts','representations','inscriptions',
    'appointments','quotes','quote_lines','invoices','invoice_lines','payments',
    'purchases','expenses','bank_accounts','bank_entries','cash_entries',
    'documents','inventory_items','inventory_movements'];
BEGIN
  FOREACH t IN ARRAY business LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN tenant_id uuid REFERENCES tenants(id)', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id SET NOT NULL', t);
    EXECUTE format('CREATE INDEX %I ON %I (tenant_id)', t || '_tenant_idx', t);
  END LOOP;
END $$;

-- ── Re-scope uniqueness ─────────────────────────────────────────────────────
-- A globally unique invoice number is both a functional bug and a leak: it
-- stops Company B issuing 2026-001 because Company A did, and the violation
-- TELLS B that someone else used it.
DO $$
DECLARE
  r record;
  -- Exactly the column-level UNIQUE constraints that exist in 001, verified
  -- against the catalogue rather than assumed: payments, bank_accounts and
  -- inventory_items.legacy_id do NOT have one, and listing them would abort
  -- the migration.
  pairs text[][] := ARRAY[
    ['natures','legacy_id'],['expense_categories','legacy_id'],['clients','legacy_id'],
    ['contacts','legacy_id'],['suppliers','legacy_id'],['collaborators','legacy_id'],
    ['projects','legacy_id'],['projects','reference'],['contracts','legacy_id'],
    ['representations','legacy_id'],['inscriptions','legacy_id'],['appointments','legacy_id'],
    ['quotes','legacy_id'],['quotes','number'],['invoices','legacy_id'],['invoices','number'],
    ['purchases','legacy_id'],['expenses','legacy_id'],['bank_entries','legacy_id'],
    ['cash_entries','legacy_id'],['documents','legacy_id'],['inventory_items','sku']];
  i int;
BEGIN
  FOR i IN 1 .. array_length(pairs, 1) LOOP
    -- Drop the column-level UNIQUE PostgreSQL named <table>_<column>_key.
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
                   pairs[i][1], pairs[i][1] || '_' || pairs[i][2] || '_key');
    -- Partial: several rows may legitimately have no legacy_id or no number.
    EXECUTE format('CREATE UNIQUE INDEX %I ON %I (tenant_id, %I) WHERE %I IS NOT NULL',
                   pairs[i][1] || '_tenant_' || pairs[i][2] || '_key',
                   pairs[i][1], pairs[i][2], pairs[i][2]);
  END LOOP;
END $$;

-- documents.storage_key stays GLOBALLY unique: it is an opaque
-- platform-generated content key, never a tenant-chosen name, and global
-- uniqueness is what keeps the storage layer safe.

-- ── Row-Level Security ──────────────────────────────────────────────────────
-- If the application forgets to set the tenant, this returns NULL, every
-- policy evaluates to NULL, and NO rows are visible. A forgotten tenant
-- context yields an empty result set — never someone else's data.
CREATE FUNCTION current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('mythos_erp.tenant_id', true), '')::uuid
$$;

DO $$
DECLARE
  t text;
  scoped text[] := ARRAY[
    'natures','expense_categories','clients','contacts','suppliers',
    'collaborators','projects','contracts','representations','inscriptions',
    'appointments','quotes','quote_lines','invoices','invoice_lines','payments',
    'purchases','expenses','bank_accounts','bank_entries','cash_entries',
    'documents','inventory_items','inventory_movements','user_roles'];
BEGIN
  FOREACH t IN ARRAY scoped LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- USING governs reads; WITH CHECK governs writes, so a forged tenant_id in
    -- a request body is refused by PostgreSQL, not by a validator someone
    -- might forget to call.
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant())'
      ' WITH CHECK (tenant_id = current_tenant())', t);
  END LOOP;
END $$;

-- The authenticated user, for the one question that legitimately precedes
-- choosing a tenant: "which companies may I enter?". Set only on platform-level
-- transactions; inside a tenant transaction it stays NULL, so the membership
-- policy below degrades to plain tenant scoping and the user list cannot reach
-- across companies.
CREATE FUNCTION current_app_user() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('mythos_erp.user_id', true), '')::uuid
$$;

-- tenant_memberships is read in two different situations and needs both:
--   * inside a tenant  → the member list of THIS company
--   * before any tenant → the caller's OWN memberships, to offer a choice
-- Writes still require tenant context, so self-service cannot grant access.
ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_memberships
  USING (tenant_id = current_tenant() OR user_id = current_app_user())
  WITH CHECK (tenant_id = current_tenant());

ALTER TABLE tenant_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_modules
  USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());

-- A tenant may read its OWN row. A user may additionally read the rows of the
-- companies they belong to — without this, "which companies may I enter?"
-- joins a table it cannot see and every login lands with no tenant at all.
-- Writes remain strictly the active tenant's own row.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON tenants
  USING (
    id = current_tenant()
    OR EXISTS (SELECT 1 FROM tenant_memberships m
               WHERE m.tenant_id = tenants.id
                 AND m.user_id = current_app_user()
                 AND m.status = 'active')
  )
  WITH CHECK (id = current_tenant());

-- Audit: reads are tenant-scoped; inserts allow the platform-level row only
-- when no tenant is active. IS NOT DISTINCT FROM makes NULL = NULL true.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_tenant_read ON audit_log FOR SELECT
  USING (tenant_id = current_tenant());
CREATE POLICY audit_tenant_insert ON audit_log FOR INSERT
  WITH CHECK (tenant_id IS NOT DISTINCT FROM current_tenant());

-- ── Audit taxonomy: the tenancy events ──────────────────────────────────────
-- Extended HERE rather than by editing 002, because the migration runner
-- refuses a file that changed after being applied — and that rule is worth
-- more than the tidiness of one constraint living in one place.
ALTER TABLE audit_log DROP CONSTRAINT audit_action_known;
ALTER TABLE audit_log ADD CONSTRAINT audit_action_known CHECK (action IN (
    'login.success','login.failure','logout','session.revoked',
    'password.reset_requested','password.reset_completed','password.changed',
    'mfa.enabled','mfa.disabled',
    'record.created','record.updated','record.deleted','record.restored',
    'permission.denied','role.assigned','role.revoked',
    'user.created','user.disabled','user.enabled',
    'export','backup.created','backup.restored',
    'tenant.switched','tenant.created','tenant.updated',
    'module.enabled','module.disabled',
    'membership.granted','membership.revoked'
));

-- ── Invoices are their own module, so they need their own permissions ──────
-- 002 folded invoicing into finance. The platform brief lists Invoices as a
-- separate module a tenant can enable alone, and a module with no permission
-- keys is unreachable: requiredPermission() returns null and the request is
-- denied by default. Granted explicitly per role — a new permission does not
-- retroactively join the seed queries in 002.
INSERT INTO permissions (key, label) VALUES
  ('invoices.read','View invoices'),
  ('invoices.write','Create/edit invoices'),
  ('invoices.delete','Cancel invoices');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key IN ('super_admin','admin') AND p.key LIKE 'invoices.%';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key IN ('manager','finance_user') AND p.key IN ('invoices.read','invoices.write');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key = 'read_only' AND p.key = 'invoices.read';

-- ── Tenant #1 ───────────────────────────────────────────────────────────────
-- Seeded like any other tenant would be. Nothing below is referenced by name
-- anywhere in the engine.
INSERT INTO tenants (key, display_name, legal_name, invoice_prefix, locale, currency)
VALUES ('mythos', 'Mythos Prod', 'Mythos Production', 'MP', 'fr-TN', 'TND');

INSERT INTO tenant_modules (tenant_id, module_key, enabled)
SELECT t.id, m.k, true
FROM tenants t
CROSS JOIN (VALUES ('dashboard'),('clients'),('projects'),('planning'),
                   ('production'),('finance'),('invoices'),('documents'),
                   ('reports'),('inventory'),('settings'),('users'),('audit')) AS m(k)
WHERE t.key = 'mythos';

COMMIT;
