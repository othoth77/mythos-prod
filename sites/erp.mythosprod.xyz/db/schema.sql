-- Mythos ERP — PostgreSQL schema proposal (Stage 3)
--
-- STATUS: PROPOSAL. Not applied. No database, role or table has been created.
-- Target: PostgreSQL 15.18 on the existing idauto-postgres container.
--
-- Placement rationale: a dedicated database `mythos_erp`, not a schema inside
-- `idauto`. The server already hosts mythos_command_center alongside idauto and
-- ssangyong_autos, so per-application databases are the established pattern
-- here, and it keeps the ERP's backup, restore and grants independent of
-- IDAuto's.
--
-- Container ceiling is 384 MiB (28 MiB in use). This schema is deliberately
-- modest: no partitioning, no materialised views, no extensions beyond citext.
--
-- Conventions:
--   * UUID primary keys via gen_random_uuid() — built into PG13+, no extension.
--   * legacy_id preserves the Date.now() identifiers the current app generates,
--     so a migration is reversible and re-runnable (see §Migration).
--   * Money is numeric(14,3): the domain is Tunisian (invoice records carry
--     `mf`/matricule fiscal and TVA), and the dinar subdivides into 1000
--     millimes. Float would be wrong here in a way that only shows up in
--     reconciliation.
--   * Nothing is ever hard-deleted: deleted_at marks a row retired. The ERP's
--     own backup module never deletes either; this keeps that property.
--   * Every table carries created_at/updated_at, maintained by trigger.

BEGIN;

CREATE EXTENSION IF NOT EXISTS citext;   -- case-insensitive email
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- required by the clients name index below

-- ── Conventions plumbing ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- IF NOT EXISTS because api/migrations/migrate.js creates this table itself
-- before it applies the first migration, with an identical definition. Without
-- it the runner and this file collide and schema.sql can never be applied by
-- the runner at all. Declared here as well so the file stays applicable on its
-- own, e.g. into a throwaway instance with psql -f.
CREATE TABLE IF NOT EXISTS schema_migrations (
    version      text PRIMARY KEY,
    applied_at   timestamptz NOT NULL DEFAULT now(),
    checksum     text NOT NULL
);

-- ── Identity and access (populated in Stage 4, defined now) ─────────────────
CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         citext NOT NULL UNIQUE,
    display_name  text   NOT NULL,
    password_hash text,                       -- self-describing KDF output; NULL while SSO-only
    is_active     boolean NOT NULL DEFAULT true,
    last_login_at timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    deleted_at    timestamptz
);

CREATE TABLE roles (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key         text NOT NULL UNIQUE,          -- admin | manager | accountant | viewer
    label       text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key         text NOT NULL UNIQUE,          -- clients.read | invoices.write | …
    label       text NOT NULL
);

CREATE TABLE role_permissions (
    role_id       uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
    user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id  uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

-- Append-only. Closes Stage 1 finding M9 (no audit log anywhere).
CREATE TABLE audit_log (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at  timestamptz NOT NULL DEFAULT now(),
    actor_id     uuid REFERENCES users(id),
    actor_label  text NOT NULL,                -- denormalised: survives user deletion
    action       text NOT NULL,                -- create | update | delete | restore | login | export
    entity_table text NOT NULL,
    entity_id    uuid,
    outcome      text NOT NULL,                -- ok | denied | error
    detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
    ip           inet,
    CONSTRAINT audit_action_known CHECK (action <> ''),
    CONSTRAINT audit_outcome_known CHECK (outcome IN ('ok','denied','error'))
);
CREATE INDEX audit_log_occurred_idx ON audit_log (occurred_at DESC);
CREATE INDEX audit_log_entity_idx   ON audit_log (entity_table, entity_id);

-- ── Reference data ──────────────────────────────────────────────────────────
CREATE TABLE natures (                          -- legacy mp_natures
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id  text UNIQUE,
    label      text NOT NULL,
    kind       text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE TABLE expense_categories (               -- legacy mp_expense_categories
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id  text UNIQUE,
    label      text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

-- ── Parties ─────────────────────────────────────────────────────────────────
CREATE TABLE clients (                          -- legacy mp_clients
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id     text UNIQUE,
    name          text NOT NULL,
    tax_id        text,                         -- `mf` — matricule fiscal
    email         citext,
    phone         text,
    address       text,
    city          text,
    postal_code   text,
    notes         text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    deleted_at    timestamptz
);
CREATE INDEX clients_name_trgm ON clients USING gin (name gin_trgm_ops);

CREATE TABLE contacts (                         -- legacy mp_repertoire_contacts + contacts module
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id   text UNIQUE,
    client_id   uuid REFERENCES clients(id),
    full_name   text NOT NULL,
    email       citext,
    phone       text,
    role_label  text,
    source      text,                           -- manual | google_import
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz
);

CREATE TABLE suppliers (                        -- legacy mp_suppliers / fournisseurs
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id  text UNIQUE,
    name       text NOT NULL,
    tax_id     text,
    email      citext,
    phone      text,
    address    text,
    notes      text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE TABLE collaborators (                    -- legacy mp_collabs
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id  text UNIQUE,
    user_id    uuid REFERENCES users(id),       -- linked once they can sign in
    full_name  text NOT NULL,
    email      citext,
    phone      text,
    role_label text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

-- ── Projects / production ───────────────────────────────────────────────────
CREATE TABLE projects (                         -- legacy mp_oms (ordres de mission)
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id    text UNIQUE,
    reference    text UNIQUE,
    title        text NOT NULL,
    client_id    uuid REFERENCES clients(id),
    nature_id    uuid REFERENCES natures(id),
    status       text NOT NULL DEFAULT 'draft',
    starts_on    date,
    ends_on      date,
    notes        text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    deleted_at   timestamptz,
    CONSTRAINT projects_dates_ordered CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);

CREATE TABLE contracts (                        -- legacy mp_contracts
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id   text UNIQUE,
    project_id  uuid REFERENCES projects(id),
    client_id   uuid REFERENCES clients(id),
    reference   text,
    status      text NOT NULL DEFAULT 'draft',
    signed_on   date,
    amount_ttc  numeric(14,3),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz
);

CREATE TABLE representations (                  -- legacy mp_representations (spectacles)
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id   text UNIQUE,
    project_id  uuid REFERENCES projects(id),
    title       text NOT NULL,
    venue       text,
    starts_at   timestamptz,
    capacity    integer CHECK (capacity IS NULL OR capacity >= 0),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz
);

CREATE TABLE inscriptions (                     -- legacy inscriptions module
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id         text UNIQUE,
    representation_id uuid REFERENCES representations(id),
    contact_id        uuid REFERENCES contacts(id),
    status            text NOT NULL DEFAULT 'registered',
    registered_at     timestamptz NOT NULL DEFAULT now(),
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    deleted_at        timestamptz
);

-- ── Planning ────────────────────────────────────────────────────────────────
CREATE TABLE appointments (                     -- legacy mp_rdvs / mp_rendez_vous
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id   text UNIQUE,
    title       text NOT NULL,
    client_id   uuid REFERENCES clients(id),
    project_id  uuid REFERENCES projects(id),
    starts_at   timestamptz NOT NULL,
    ends_at     timestamptz,
    location    text,
    notes       text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz,
    CONSTRAINT appointments_span CHECK (ends_at IS NULL OR ends_at >= starts_at)
);
CREATE INDEX appointments_starts_idx ON appointments (starts_at);

-- ── Finance ─────────────────────────────────────────────────────────────────
-- Quotes and invoices share a line shape; both are headers with line children,
-- because the legacy records carry pu/qty/unit per line and totalling them in
-- the client is what produced the reconciliation drift the accounting modules
-- work around.
CREATE TABLE quotes (                           -- legacy mp_devis
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id   text UNIQUE,
    number      text UNIQUE,
    client_id   uuid REFERENCES clients(id),
    project_id  uuid REFERENCES projects(id),
    issued_on   date NOT NULL DEFAULT current_date,
    valid_until date,
    status      text NOT NULL DEFAULT 'draft',
    currency    char(3) NOT NULL DEFAULT 'TND',
    notes       text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz
);

CREATE TABLE quote_lines (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_id    uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    position    integer NOT NULL DEFAULT 0,
    description text NOT NULL,
    unit        text,
    quantity    numeric(12,3) NOT NULL DEFAULT 1,
    unit_price  numeric(14,3) NOT NULL DEFAULT 0,
    vat_rate    numeric(5,2)  NOT NULL DEFAULT 19.00,
    line_ht     numeric(14,3) GENERATED ALWAYS AS (quantity * unit_price) STORED
);
CREATE INDEX quote_lines_quote_idx ON quote_lines (quote_id, position);

CREATE TABLE invoices (                         -- legacy mp_invoices
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id   text UNIQUE,
    number      text UNIQUE,
    client_id   uuid REFERENCES clients(id),
    project_id  uuid REFERENCES projects(id),
    quote_id    uuid REFERENCES quotes(id),
    issued_on   date NOT NULL DEFAULT current_date,
    due_on      date,
    status      text NOT NULL DEFAULT 'draft',  -- draft|sent|part_paid|paid|cancelled
    currency    char(3) NOT NULL DEFAULT 'TND',
    payment_mode text,
    notes       text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz
);
CREATE INDEX invoices_client_idx ON invoices (client_id);
CREATE INDEX invoices_status_idx ON invoices (status) WHERE deleted_at IS NULL;

CREATE TABLE invoice_lines (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id  uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    position    integer NOT NULL DEFAULT 0,
    description text NOT NULL,
    unit        text,
    quantity    numeric(12,3) NOT NULL DEFAULT 1,
    unit_price  numeric(14,3) NOT NULL DEFAULT 0,
    vat_rate    numeric(5,2)  NOT NULL DEFAULT 19.00,
    line_ht     numeric(14,3) GENERATED ALWAYS AS (quantity * unit_price) STORED
);
CREATE INDEX invoice_lines_invoice_idx ON invoice_lines (invoice_id, position);

CREATE TABLE payments (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id  uuid NOT NULL REFERENCES invoices(id),
    paid_on     date NOT NULL DEFAULT current_date,
    amount      numeric(14,3) NOT NULL CHECK (amount > 0),
    method      text,
    reference   text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE purchases (                        -- legacy mp_purchases
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id    text UNIQUE,
    supplier_id  uuid REFERENCES suppliers(id),
    reference    text,
    purchased_on date NOT NULL DEFAULT current_date,
    amount_ht    numeric(14,3) NOT NULL DEFAULT 0,
    vat_rate     numeric(5,2)  NOT NULL DEFAULT 19.00,
    notes        text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    deleted_at   timestamptz
);

CREATE TABLE expenses (                         -- legacy mp_expenses
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id   text UNIQUE,
    category_id uuid REFERENCES expense_categories(id),
    project_id  uuid REFERENCES projects(id),
    spent_on    date NOT NULL DEFAULT current_date,
    amount      numeric(14,3) NOT NULL,
    description text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz
);

CREATE TABLE bank_accounts (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    label      text NOT NULL,
    iban       text,
    currency   char(3) NOT NULL DEFAULT 'TND',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE TABLE bank_entries (                     -- legacy mp_bank_entries
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id   text UNIQUE,
    account_id  uuid REFERENCES bank_accounts(id),
    entry_date  date NOT NULL,
    label       text NOT NULL,
    amount      numeric(14,3) NOT NULL,        -- signed: credit positive
    reconciled  boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz
);
CREATE INDEX bank_entries_date_idx ON bank_entries (entry_date DESC);

CREATE TABLE cash_entries (                     -- legacy mp_cash_entries
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id   text UNIQUE,
    entry_date  date NOT NULL,
    label       text NOT NULL,
    amount      numeric(14,3) NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz
);

-- ── Documents — metadata only; bytes live outside the docroot ───────────────
-- Closes Stage 1 findings C1/H5: the database never stores an executable path,
-- only an opaque storage_key resolved by the storage service.
CREATE TABLE documents (                        -- legacy mp_documents / mp_rddocs_*
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id     text UNIQUE,
    storage_key   text NOT NULL UNIQUE,         -- opaque; never a client-supplied name
    original_name text NOT NULL,                -- display only, never used as a path
    mime_type     text NOT NULL,                -- determined server-side
    byte_size     bigint NOT NULL CHECK (byte_size >= 0),
    sha256        char(64) NOT NULL,
    category      text,
    client_id     uuid REFERENCES clients(id),
    project_id    uuid REFERENCES projects(id),
    uploaded_by   uuid REFERENCES users(id),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    deleted_at    timestamptz
);
CREATE INDEX documents_sha_idx ON documents (sha256);

-- ── Inventory — the one genuinely new module ────────────────────────────────
CREATE TABLE inventory_items (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sku          text UNIQUE,
    label        text NOT NULL,
    unit         text,
    min_quantity numeric(12,3) NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    deleted_at   timestamptz
);

CREATE TABLE inventory_movements (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id     uuid NOT NULL REFERENCES inventory_items(id),
    moved_at    timestamptz NOT NULL DEFAULT now(),
    quantity    numeric(12,3) NOT NULL,        -- signed: in positive, out negative
    reason      text NOT NULL,
    project_id  uuid REFERENCES projects(id),
    actor_id    uuid REFERENCES users(id),
    CONSTRAINT inventory_movement_nonzero CHECK (quantity <> 0)
);
CREATE INDEX inventory_movements_item_idx ON inventory_movements (item_id, moved_at DESC);

-- ── updated_at triggers ─────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'updated_at'
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;

-- ── Least-privilege application role ────────────────────────────────────────
-- The app role owns nothing and cannot change structure. Migrations run as a
-- separate owner. Closes the "application is superuser" failure mode before it
-- can be introduced.
--   CREATE ROLE erp_owner LOGIN PASSWORD :'owner_pw';
--   CREATE ROLE erp_app   LOGIN PASSWORD :'app_pw';
--   CREATE DATABASE mythos_erp OWNER erp_owner;
--   REVOKE ALL ON SCHEMA public FROM PUBLIC;
--   GRANT USAGE ON SCHEMA public TO erp_app;
--   GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO erp_app;
--   -- deliberately no DELETE: retirement is deleted_at, and audit_log is append-only
--   -- ONE exception, and only one: invoice_lines.
--   -- The no-DELETE rule protects BUSINESS RECORDS, which retire by setting
--   -- deleted_at. invoice_lines is not one of those: it is a pure child of its
--   -- invoice and has NO deleted_at column, so the rule cannot even express
--   -- "this line is gone". modules/invoices.js replaceLines() rewrites an
--   -- invoice's lines by deleting and re-inserting them, and totals() sums every
--   -- line row with no deleted_at filter -- so soft-deleting a line would
--   -- silently corrupt the invoice total. Without this grant the engine cannot
--   -- create an invoice at all: the acceptance suite fails with "permission
--   -- denied for table invoice_lines" even on a create, because PostgreSQL
--   -- checks the privilege before discovering there is nothing to delete.
--   GRANT DELETE ON invoice_lines TO erp_app;
--   REVOKE UPDATE, DELETE ON audit_log FROM erp_app;
--   GRANT INSERT, SELECT ON audit_log TO erp_app;
--   GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO erp_app;

-- ── Foreign-key indexes ─────────────────────────────────────────────────────
-- Validation against a throwaway PG15 instance found 28 foreign keys with no
-- supporting index. PostgreSQL does not create these automatically, and without
-- them every join and every referential check on the child side is a sequential
-- scan. Added after the fact rather than assumed correct — which is the reason
-- the schema was validated before being proposed for use.
CREATE INDEX appointments_client_idx        ON appointments (client_id);
CREATE INDEX appointments_project_idx       ON appointments (project_id);
CREATE INDEX audit_log_actor_idx            ON audit_log (actor_id);
CREATE INDEX bank_entries_account_idx       ON bank_entries (account_id);
CREATE INDEX collaborators_user_idx         ON collaborators (user_id);
CREATE INDEX contacts_client_idx            ON contacts (client_id);
CREATE INDEX contracts_client_idx           ON contracts (client_id);
CREATE INDEX contracts_project_idx          ON contracts (project_id);
CREATE INDEX documents_client_idx           ON documents (client_id);
CREATE INDEX documents_project_idx          ON documents (project_id);
CREATE INDEX documents_uploaded_by_idx      ON documents (uploaded_by);
CREATE INDEX expenses_category_idx          ON expenses (category_id);
CREATE INDEX expenses_project_idx           ON expenses (project_id);
CREATE INDEX inscriptions_contact_idx       ON inscriptions (contact_id);
CREATE INDEX inscriptions_representation_idx ON inscriptions (representation_id);
CREATE INDEX inventory_movements_actor_idx  ON inventory_movements (actor_id);
CREATE INDEX inventory_movements_project_idx ON inventory_movements (project_id);
CREATE INDEX invoices_project_idx           ON invoices (project_id);
CREATE INDEX invoices_quote_idx             ON invoices (quote_id);
CREATE INDEX payments_invoice_idx           ON payments (invoice_id);
CREATE INDEX projects_client_idx            ON projects (client_id);
CREATE INDEX projects_nature_idx            ON projects (nature_id);
CREATE INDEX purchases_supplier_idx         ON purchases (supplier_id);
CREATE INDEX quotes_client_idx              ON quotes (client_id);
CREATE INDEX quotes_project_idx             ON quotes (project_id);
CREATE INDEX representations_project_idx    ON representations (project_id);
CREATE INDEX role_permissions_permission_idx ON role_permissions (permission_id);
CREATE INDEX user_roles_role_idx            ON user_roles (role_id);

COMMIT;
