-- 0013-expenses-ledger.sql — Phase 7 (P1 Expense management → ledger).
--
-- Expenses have existed since schema.sql (legacy mp_expenses: date, label,
-- category, amount) and were the one money-moving record that never reached
-- the general ledger: reports/expenses and the trial balance were two truths
-- that could not agree. This migration gives an expense exactly what the
-- legacy ERP's own expense form carried and the ledger needs, nothing more:
--
--   1. payment_method — free text, the same convention as payments.method
--      (legacy modes: BIAT, Virement, Espèces, Chèque, Carte). It decides
--      the treasury side of the posting through the same cash/bank rule
--      accounting.js already applies to invoice and supplier payments.
--   2. vat_rate (default 0) — an expense is recorded at the amount PAID; the
--      rate, when the receipt shows one, splits it into HT + deductible VAT
--      exactly the way the legacy purchase calculator reversed a TTC
--      (js/shared/accounting-tva.js). 0 = no VAT split.
--   3. supplier_id — optional link to the existing suppliers table (reuse,
--      not a duplicate entity). No approval workflow, no attachment: the
--      legacy ERP had neither, and nothing here is invented beyond it.
--   4. expense_categories.account_id — optional: a category may point at the
--      expense account its lines should debit (Transport → 61, …). When it
--      does not, the tenant's default expense account is used:
--   5. a new system_key 'expenses', looked up by role like the ten others.
--      IMPLEMENTATION ASSUMPTION (flagged): it is placed on the already
--      seeded '62 — Autres services extérieurs'; the tenant renames/moves
--      it in the Plan comptable, only the system_key matters.
--
-- Posting rules (api/modules/accounting.js postExpense/reverseExpense): one
-- entry per expense, idempotent on (source_table='expenses', source_id),
-- created when the expense is recorded (the money has already left), reversed
-- when it is retired. Amount/date/VAT/method/category are immutable once
-- posted — retire and recreate, the same rule invoices apply to a paid
-- document — so the ledger never drifts from the row it was posted from.
-- Rows that already exist at migration time are NOT retro-posted (production
-- has none; a tenant with history keeps it as it was).
--
-- Reversible: drop the three expense columns and their CHECKs, drop
-- expense_categories.account_id, clear system_key on the '62' rows and
-- restore the previous CHECK.

BEGIN;

ALTER TABLE expenses
    ADD COLUMN payment_method text,
    ADD COLUMN vat_rate numeric(5,2) NOT NULL DEFAULT 0,
    ADD COLUMN supplier_id uuid REFERENCES suppliers(id);
ALTER TABLE expenses ADD CONSTRAINT expenses_vat_rate_range CHECK (vat_rate >= 0 AND vat_rate <= 100);
ALTER TABLE expenses ADD CONSTRAINT expenses_amount_nonnegative CHECK (amount >= 0);
CREATE INDEX expenses_spent_on_idx ON expenses (spent_on DESC) WHERE deleted_at IS NULL;
CREATE INDEX expenses_supplier_idx ON expenses (supplier_id) WHERE supplier_id IS NOT NULL;

ALTER TABLE expense_categories ADD COLUMN account_id uuid REFERENCES accounts(id);

ALTER TABLE accounts DROP CONSTRAINT account_system_key_known;
ALTER TABLE accounts ADD CONSTRAINT account_system_key_known CHECK (system_key IS NULL OR system_key IN
    ('receivable','payable','bank','cash','vat_collected','vat_deductible','sales','purchases',
     'stamp_collected','stamp_expense','expenses'));

-- Same function as 0011, with '62' carrying the new system_key.
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
    (p_tenant, '4368', 'État, droits de timbre collectés',   'liability', 'stamp_collected'),
    (p_tenant, '532',  'Banque',                             'asset',     'bank'),
    (p_tenant, '54',   'Caisse',                             'asset',     'cash'),
    (p_tenant, '606',  'Achats non stockés de matières et fournitures', 'expense', 'purchases'),
    (p_tenant, '61',   'Services extérieurs',                'expense',   NULL),
    (p_tenant, '62',   'Autres services extérieurs',         'expense',   'expenses'),
    (p_tenant, '6354', 'Droits d''enregistrement et de timbre', 'expense', 'stamp_expense'),
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

-- Configured tenants: give the existing '62' row the role, unless the tenant
-- already assigned 'expenses' to some account of its own. Keyed on the
-- system_key's absence, never on the code alone; a tenant without a '62'
-- keeps posting refused loudly by accounting.js until it picks an account.
UPDATE accounts a SET system_key = 'expenses'
 WHERE a.code = '62' AND a.system_key IS NULL AND a.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.tenant_id = a.tenant_id AND x.system_key = 'expenses');

-- No new grant: expenses / expense_categories / accounts are already granted
-- to erp_app for SELECT, INSERT, UPDATE.

COMMIT;
