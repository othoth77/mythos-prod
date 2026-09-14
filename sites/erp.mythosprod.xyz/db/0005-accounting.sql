-- 0005-accounting.sql — Comptabilité / General Ledger foundation (Phase 9).
--
-- Double-entry bookkeeping scoped per tenant: chart of accounts, journals,
-- fiscal periods, journal entries with balanced debit/credit lines, posting,
-- reversal, and the automatic links from invoices and payments. The invariants
-- that make a ledger trustworthy are enforced by the DATABASE, not only by the
-- API: an entry cannot be posted unbalanced or into a closed period, a posted
-- entry and its lines are immutable (only reversal may touch it), a closed
-- period cannot receive postings.
--
-- Amounts are numeric(14,3): the dinar subdivides into millimes.
-- Applied by api/migrations/migrate.js as erp_owner after 0004. Idempotent.
BEGIN;

-- ── Chart of accounts ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    code         text NOT NULL,                         -- e.g. 411, 4367, 706
    label        text NOT NULL,
    type         text NOT NULL,                         -- asset | liability | equity | revenue | expense
    parent_code  text,
    -- Role of the account in automatic postings. One account per role per tenant.
    system_key   text,                                  -- receivable | payable | bank | cash | vat_collected | vat_deductible | sales | purchases
    is_active    boolean NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    deleted_at   timestamptz,
    CONSTRAINT account_type_known CHECK (type IN ('asset','liability','equity','revenue','expense')),
    CONSTRAINT account_system_key_known CHECK (system_key IS NULL OR system_key IN
        ('receivable','payable','bank','cash','vat_collected','vat_deductible','sales','purchases')),
    CONSTRAINT account_code_shape CHECK (code ~ '^[0-9]{1,10}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_tenant_code_key ON accounts (tenant_id, code);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_tenant_system_key ON accounts (tenant_id, system_key) WHERE system_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS accounts_tenant_idx ON accounts (tenant_id);

-- ── Journals ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS journals (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    code        text NOT NULL,                          -- VT, AC, BQ, CA, OD
    label       text NOT NULL,
    kind        text NOT NULL,                          -- sales | purchases | bank | cash | general
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz,
    CONSTRAINT journal_kind_known CHECK (kind IN ('sales','purchases','bank','cash','general'))
);
CREATE UNIQUE INDEX IF NOT EXISTS journals_tenant_code_key ON journals (tenant_id, code);
CREATE INDEX IF NOT EXISTS journals_tenant_idx ON journals (tenant_id);

-- ── Fiscal periods ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fiscal_periods (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    code        text NOT NULL,                          -- YYYY-MM
    starts_on   date NOT NULL,
    ends_on     date NOT NULL,
    status      text NOT NULL DEFAULT 'open',           -- open | closed
    closed_at   timestamptz,
    closed_by   uuid REFERENCES users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT period_status_known CHECK (status IN ('open','closed')),
    CONSTRAINT period_dates_ordered CHECK (starts_on <= ends_on),
    CONSTRAINT period_code_shape CHECK (code ~ '^[0-9]{4}-[0-9]{2}$'),
    CONSTRAINT period_closed_consistent CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_periods_tenant_code_key ON fiscal_periods (tenant_id, code);
CREATE INDEX IF NOT EXISTS fiscal_periods_tenant_range_idx ON fiscal_periods (tenant_id, starts_on, ends_on);

-- ── Entry numbering: one counter row per tenant, claimed with UPDATE … RETURNING
CREATE TABLE IF NOT EXISTS accounting_counters (
    tenant_id      uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    next_entry_no  integer NOT NULL DEFAULT 1
);

-- ── Journal entries and lines ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS journal_entries (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    entry_no      integer NOT NULL,
    journal_id    uuid NOT NULL REFERENCES journals(id),
    period_id     uuid NOT NULL REFERENCES fiscal_periods(id),
    entry_date    date NOT NULL DEFAULT current_date,
    reference     text,
    memo          text,
    status        text NOT NULL DEFAULT 'draft',        -- draft | posted | reversed | void
    posted_at     timestamptz,
    posted_by     uuid REFERENCES users(id),
    reverses_id   uuid REFERENCES journal_entries(id),  -- set on the reversal entry
    reversed_by_id uuid REFERENCES journal_entries(id), -- set on the reversed original
    source_table  text,                                 -- invoices | payments | invoice_cancel (automatic links)
    source_id     uuid,
    created_by    uuid REFERENCES users(id),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT entry_status_known CHECK (status IN ('draft','posted','reversed','void')),
    CONSTRAINT entry_posted_consistent CHECK ((status IN ('posted','reversed')) = (posted_at IS NOT NULL)),
    CONSTRAINT entry_reversed_consistent CHECK ((status = 'reversed') = (reversed_by_id IS NOT NULL)),
    CONSTRAINT entry_source_pair CHECK ((source_table IS NULL) = (source_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_tenant_no_key ON journal_entries (tenant_id, entry_no);
-- one automatic entry per source event (an invoice issue, a payment, a cancellation)
CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_source_key ON journal_entries (tenant_id, source_table, source_id) WHERE source_table IS NOT NULL;
CREATE INDEX IF NOT EXISTS journal_entries_tenant_date_idx ON journal_entries (tenant_id, entry_date);
CREATE INDEX IF NOT EXISTS journal_entries_period_idx ON journal_entries (period_id);
CREATE INDEX IF NOT EXISTS journal_entries_journal_idx ON journal_entries (journal_id);

CREATE TABLE IF NOT EXISTS journal_lines (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    entry_id    uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    position    integer NOT NULL DEFAULT 0,
    account_id  uuid NOT NULL REFERENCES accounts(id),
    label       text,
    debit       numeric(14,3) NOT NULL DEFAULT 0,
    credit      numeric(14,3) NOT NULL DEFAULT 0,
    vat_rate    numeric(5,2),                           -- informational: the rate a VAT line represents
    CONSTRAINT line_nonneg CHECK (debit >= 0 AND credit >= 0),
    CONSTRAINT line_one_side CHECK (NOT (debit > 0 AND credit > 0)),
    CONSTRAINT line_nonzero CHECK (debit > 0 OR credit > 0)
);
CREATE INDEX IF NOT EXISTS journal_lines_entry_idx ON journal_lines (entry_id, position);
CREATE INDEX IF NOT EXISTS journal_lines_account_idx ON journal_lines (tenant_id, account_id);

-- ── updated_at triggers ────────────────────────────────────────────────────
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['accounts','journals','fiscal_periods','journal_entries'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_set_updated_at ON %I', t, t);
    EXECUTE format('CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;

-- ── Ledger invariants, enforced in the database ────────────────────────────
-- Posting: balanced, ≥ 2 lines, period open. Posted/reversed entries: immutable
-- except the single reversed transition. Lines: frozen once the entry left draft.
CREATE OR REPLACE FUNCTION journal_entry_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  n_lines integer; sum_debit numeric(14,3); sum_credit numeric(14,3); period_status text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'reversed' OR OLD.status = 'void' THEN
      RAISE EXCEPTION 'journal entry % is % and immutable', OLD.entry_no, OLD.status USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'posted' THEN
      -- The only permitted change to a posted entry: becoming reversed by a reversal entry.
      IF NOT (NEW.status = 'reversed' AND NEW.reversed_by_id IS NOT NULL
              AND NEW.entry_no = OLD.entry_no AND NEW.journal_id = OLD.journal_id AND NEW.period_id = OLD.period_id
              AND NEW.entry_date = OLD.entry_date AND NEW.posted_at = OLD.posted_at
              AND coalesce(NEW.memo,'') = coalesce(OLD.memo,'') AND coalesce(NEW.reference,'') = coalesce(OLD.reference,'')) THEN
        RAISE EXCEPTION 'journal entry % is posted and immutable', OLD.entry_no USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF NEW.status = 'posted' AND OLD.status = 'draft' THEN
      SELECT count(*), coalesce(sum(debit),0), coalesce(sum(credit),0) INTO n_lines, sum_debit, sum_credit
        FROM journal_lines WHERE entry_id = NEW.id;
      IF n_lines < 2 THEN
        RAISE EXCEPTION 'journal entry % needs at least two lines to post', NEW.entry_no USING ERRCODE = 'check_violation';
      END IF;
      IF sum_debit <> sum_credit THEN
        RAISE EXCEPTION 'journal entry % is unbalanced (debit % / credit %)', NEW.entry_no, sum_debit, sum_credit USING ERRCODE = 'check_violation';
      END IF;
      SELECT status INTO period_status FROM fiscal_periods WHERE id = NEW.period_id;
      IF period_status IS DISTINCT FROM 'open' THEN
        RAISE EXCEPTION 'fiscal period is closed; entry % cannot be posted', NEW.entry_no USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.posted_at IS NULL THEN NEW.posted_at := now(); END IF;
    END IF;
    IF NEW.status = 'draft' AND OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'a journal entry cannot return to draft' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS journal_entries_guard ON journal_entries;
CREATE TRIGGER journal_entries_guard BEFORE UPDATE ON journal_entries
    FOR EACH ROW EXECUTE FUNCTION journal_entry_guard();

CREATE OR REPLACE FUNCTION journal_line_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE st text; eid uuid;
BEGIN
  eid := CASE WHEN TG_OP = 'DELETE' THEN OLD.entry_id ELSE NEW.entry_id END;
  SELECT status INTO st FROM journal_entries WHERE id = eid;
  IF st IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'lines of a % journal entry are immutable', coalesce(st,'missing') USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS journal_lines_guard ON journal_lines;
CREATE TRIGGER journal_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON journal_lines
    FOR EACH ROW EXECUTE FUNCTION journal_line_guard();

-- Closing a period with draft entries inside would strand them: refuse.
CREATE OR REPLACE FUNCTION fiscal_period_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  IF NEW.status = 'closed' AND OLD.status = 'open' THEN
    SELECT count(*) INTO n FROM journal_entries WHERE period_id = NEW.id AND status = 'draft';
    IF n > 0 THEN
      RAISE EXCEPTION 'fiscal period % has % draft entries; post or void them before closing', NEW.code, n USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.closed_at IS NULL THEN NEW.closed_at := now(); END IF;
  END IF;
  IF NEW.status = 'open' AND OLD.status = 'closed' THEN
    NEW.closed_at := NULL; NEW.closed_by := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS fiscal_periods_guard ON fiscal_periods;
CREATE TRIGGER fiscal_periods_guard BEFORE UPDATE ON fiscal_periods
    FOR EACH ROW EXECUTE FUNCTION fiscal_period_guard();

-- ── Row-level security: identical policy to every tenant table ─────────────
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['accounts','journals','fiscal_periods','accounting_counters','journal_entries','journal_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant())', t);
  END LOOP;
END $$;

-- ── Default chart, journals and counter for a tenant (idempotent) ──────────
-- Minimal Tunisian/French-style chart. Codes are the tenant's to extend; the
-- system_key column, not the code, is what automatic postings look up.
CREATE OR REPLACE FUNCTION accounting_seed_tenant(p_tenant uuid) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n integer := 0;
BEGIN
  INSERT INTO accounts (tenant_id, code, label, type, system_key) VALUES
    (p_tenant, '101',  'Capital social',                     'equity',    NULL),
    (p_tenant, '12',   'Résultat de l''exercice',            'equity',    NULL),
    (p_tenant, '401',  'Fournisseurs',                       'liability', 'payable'),
    (p_tenant, '411',  'Clients',                            'asset',     'receivable'),
    (p_tenant, '4366', 'État, TVA déductible',               'asset',     'vat_deductible'),
    (p_tenant, '4367', 'État, TVA collectée',                'liability', 'vat_collected'),
    (p_tenant, '532',  'Banque',                             'asset',     'bank'),
    (p_tenant, '54',   'Caisse',                             'asset',     'cash'),
    (p_tenant, '606',  'Achats non stockés de matières et fournitures', 'expense', 'purchases'),
    (p_tenant, '61',   'Services extérieurs',                'expense',   NULL),
    (p_tenant, '62',   'Autres services extérieurs',         'expense',   NULL),
    (p_tenant, '64',   'Charges de personnel',               'expense',   NULL),
    (p_tenant, '66',   'Charges financières',                'expense',   NULL),
    (p_tenant, '706',  'Prestations de services',            'revenue',   'sales'),
    (p_tenant, '707',  'Ventes de marchandises',             'revenue',   NULL),
    (p_tenant, '75',   'Autres produits',                    'revenue',   NULL)
  ON CONFLICT (tenant_id, code) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO journals (tenant_id, code, label, kind) VALUES
    (p_tenant, 'VT', 'Ventes',               'sales'),
    (p_tenant, 'AC', 'Achats',               'purchases'),
    (p_tenant, 'BQ', 'Banque',               'bank'),
    (p_tenant, 'CA', 'Caisse',               'cash'),
    (p_tenant, 'OD', 'Opérations diverses',  'general')
  ON CONFLICT (tenant_id, code) DO NOTHING;
  INSERT INTO accounting_counters (tenant_id) VALUES (p_tenant) ON CONFLICT DO NOTHING;
  RETURN n;
END $$;

-- Seed every existing tenant now (a tenant created later is seeded through
-- POST /api/v1/accounting/setup, which calls the same function).
DO $$ DECLARE t uuid; BEGIN
  FOR t IN SELECT id FROM tenants WHERE deleted_at IS NULL LOOP PERFORM accounting_seed_tenant(t); END LOOP;
END $$;

-- ── Module key, permissions, role grants ───────────────────────────────────
ALTER TABLE tenant_modules DROP CONSTRAINT IF EXISTS tenant_module_known;
ALTER TABLE tenant_modules ADD CONSTRAINT tenant_module_known CHECK (module_key IN (
    'dashboard','clients','prospects','projects','planning','production','finance',
    'invoices','accounting','documents','reports','inventory','settings','users','audit'));
INSERT INTO tenant_modules (tenant_id, module_key, enabled)
SELECT id, 'accounting', true FROM tenants ON CONFLICT (tenant_id, module_key) DO NOTHING;

INSERT INTO permissions (key, label) VALUES
  ('accounting.read',  'View the ledger, trial balance and VAT'),
  ('accounting.write', 'Create/edit draft journal entries and the chart'),
  ('accounting.post',  'Post and reverse journal entries'),
  ('accounting.close', 'Close fiscal periods and set up the chart')
ON CONFLICT (key) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE (r.key = 'super_admin'   AND p.key LIKE 'accounting.%')
   OR (r.key = 'admin'         AND p.key LIKE 'accounting.%')
   OR (r.key = 'finance_user'  AND p.key IN ('accounting.read','accounting.write','accounting.post'))
   OR (r.key = 'manager'       AND p.key = 'accounting.read')
   OR (r.key = 'read_only'     AND p.key = 'accounting.read')
ON CONFLICT DO NOTHING;

-- ── Application role grants ─────────────────────────────────────────────────
-- No DELETE, with ONE exception like invoice_lines: journal_lines of a DRAFT
-- entry are replaced wholesale on edit (the trigger above refuses any change
-- once the entry is posted, so the grant cannot touch the ledger proper).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') THEN
    GRANT SELECT, INSERT, UPDATE ON accounts, journals, fiscal_periods, accounting_counters, journal_entries, journal_lines TO erp_app;
    GRANT DELETE ON journal_lines TO erp_app;
  END IF;
END $$;

COMMIT;
