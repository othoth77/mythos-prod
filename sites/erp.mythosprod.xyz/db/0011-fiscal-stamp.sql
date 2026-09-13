-- 0011-fiscal-stamp.sql — Phase 5 (P0 Fiscal / invoice compliance): the
-- Tunisian droit de timbre on invoices.
--
-- VERIFIED LEGAL BASIS (not assumption): Code des droits d'enregistrement et
-- de timbre, art. 117 §I n°6 — 1,000 dinar per invoice, raised from 0,600 by
-- décret-loi n°2022-79 (loi de finances 2023) art. 69, applicable to invoices
-- issued from 1 January 2023 (DGI Note commune n°02/2023 §II, §IV). It covers
-- every invoice including partial invoices and credit notes (DGI Note commune
-- n°06/2004 §II.1). It is NOT due on export invoices, on invoices of totally
-- exporting enterprises, or where the duty is legally borne by the State
-- (art. 118; NC 06/2004 §3). The 2026 tiered tariff (1,5 / 2 dinars) applies
-- only to "grandes surfaces" and is out of scope. It is a flat amount per
-- document, outside the VAT base, shown as its own line after the VAT total.
--
-- Model (mirrors the legacy ERP, js/shared/invoices.js:172-216, which
-- already carried `timbre` per invoice and per quote, after VAT, forced to 0
-- for VAT-exempt documents):
--
--   1. stamp_amount on invoices, quotes and purchases — a per-document
--      SNAPSHOT so an exemption (export) can be recorded as 0 on that one
--      document and so a later change of the legal rate never rewrites
--      history. It is added AFTER VAT: total_ttc = HT + VAT + stamp.
--      Purchases carry the supplier's stamp for the same reason a supplier
--      invoice's TTC includes it — without it the payable balance would be
--      off by exactly 1 dinar and the final payment refused as an overpayment.
--   2. The tenant default lives in tenants.settings->'fiscal_stamp'
--      ({enabled, amount}) — that jsonb column was plumbed for exactly this
--      kind of per-company policy and read by nothing until now. Default when
--      absent: disabled. Enabling it is a business decision the tenant makes
--      in Paramètres, never a silent change to existing totals.
--   3. Two system accounts, so the ledger legs are looked up by role, not by
--      code, exactly like the eight that exist:
--        stamp_collected — the stamp charged on a sales invoice is money the
--                          company collects for the State (a liability), not
--                          revenue: credited on issue.
--        stamp_expense   — the stamp on a supplier invoice is a cost to the
--                          company: debited on confirmation.
--      IMPLEMENTATION ASSUMPTION (flagged, not law): the seeded codes 4368
--      and 6354 follow the chart already seeded by 0005 (436x for State
--      turnover taxes, 63/65 for other taxes). Codes and labels are the
--      tenant's to rename in the Plan comptable; only system_key matters.
--
-- Reversible: drop the three stamp_amount columns and their CHECKs, restore
-- the previous account_system_key_known CHECK, and the two accounts (which
-- carry no lines until a stamped document is issued).

BEGIN;

ALTER TABLE invoices  ADD COLUMN stamp_amount numeric(14,3) NOT NULL DEFAULT 0;
ALTER TABLE quotes    ADD COLUMN stamp_amount numeric(14,3) NOT NULL DEFAULT 0;
ALTER TABLE purchases ADD COLUMN stamp_amount numeric(14,3) NOT NULL DEFAULT 0;
ALTER TABLE invoices  ADD CONSTRAINT invoices_stamp_nonnegative  CHECK (stamp_amount >= 0);
ALTER TABLE quotes    ADD CONSTRAINT quotes_stamp_nonnegative    CHECK (stamp_amount >= 0);
ALTER TABLE purchases ADD CONSTRAINT purchases_stamp_nonnegative CHECK (stamp_amount >= 0);

ALTER TABLE accounts DROP CONSTRAINT account_system_key_known;
ALTER TABLE accounts ADD CONSTRAINT account_system_key_known CHECK (system_key IS NULL OR system_key IN
    ('receivable','payable','bank','cash','vat_collected','vat_deductible','sales','purchases',
     'stamp_collected','stamp_expense'));

-- Same function as 0005, plus the two stamp accounts, so a tenant seeded
-- later (POST /accounting/setup) gets them too.
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
    (p_tenant, '62',   'Autres services extérieurs',         'expense',   NULL),
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

-- Tenants whose chart was already seeded by 0005 get only the two new
-- accounts (ON CONFLICT (tenant_id, code) DO NOTHING keeps this idempotent
-- and never touches an account a tenant renamed). A tenant with no chart at
-- all stays unconfigured, exactly as before.
-- Keyed on the system_key's absence, not on the code: a tenant that already
-- created its own 4368/6354 with a different role keeps it (the code conflict
-- is left alone) and the runtime then refuses to post a stamped document with
-- an explicit "add an account with system_key stamp_…" error (accounting.js)
-- rather than silently skipping the sales/purchase entry.
INSERT INTO accounts (tenant_id, code, label, type, system_key)
SELECT a.tenant_id, '4368', 'État, droits de timbre collectés', 'liability', 'stamp_collected'
  FROM accounts a
 WHERE a.system_key = 'sales'
   AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.tenant_id = a.tenant_id AND x.system_key = 'stamp_collected')
ON CONFLICT (tenant_id, code) DO NOTHING;
INSERT INTO accounts (tenant_id, code, label, type, system_key)
SELECT a.tenant_id, '6354', 'Droits d''enregistrement et de timbre', 'expense', 'stamp_expense'
  FROM accounts a
 WHERE a.system_key = 'sales'
   AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.tenant_id = a.tenant_id AND x.system_key = 'stamp_expense')
ON CONFLICT (tenant_id, code) DO NOTHING;

-- No new grant: the three columns live on tables erp_app already holds
-- SELECT, INSERT, UPDATE on; accounts is already granted (0005).

COMMIT;
