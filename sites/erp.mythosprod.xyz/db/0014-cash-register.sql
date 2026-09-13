-- 0014-cash-register.sql — Phase 8 (P1 Cash register / caisse).
--
-- What already exists, and is reused rather than duplicated: the cash
-- account (system_key 'cash', seeded '54') and the CA journal (0005); every
-- customer receipt, supplier payment and expense paid "espèces" already
-- posts to it (accounting.js); GET /accounting/ledger?account_id=<54> is
-- already a cash book with opening/running/closing balances.
--
-- What was missing: the movements that are NOT a document — the legacy
-- cash module's own cases (js/shared/accounting-cash.js: "Retraits en
-- espèces du compte BIAT", bank ⇄ till links) — and an operational view.
-- cash_entries (schema.sql, legacy mp_cash_entries: entry_date, label,
-- amount; tenant-scoped, RLS-enabled) has been unwired since Stage 3; it
-- becomes the manual cash movement:
--
--   kind        withdrawal  bank → till   (debit cash,  credit bank)
--               deposit     till → bank   (debit bank,  credit cash)
--               other_in    money into the till from a chosen account
--                           (debit cash, credit counterpart)
--               other_out   money out of the till to a chosen account
--                           (debit counterpart, credit cash)
--   counterpart_account_id  required for other_in/other_out, ignored for
--                           the two transfers (they use the bank system
--                           account). Any active account of this tenant —
--                           the accountant's judgement, not a hidden default.
--
-- Posting (accounting.js postCashMovement / reverseCashMovement): one entry
-- in the CA journal per movement at creation, idempotent on
-- (source_table 'cash_entries', source_id), reversed on retire; amount /
-- date / kind / counterpart are immutable once posted (retire and record a
-- new one), label and reference stay editable — the rule expenses (0013)
-- and paid invoices already follow. No daily closing or count/variance
-- workflow: the legacy ERP had none; the balance is the ledger's.
--
-- Reversible: drop the three columns and their CHECKs and the index.

BEGIN;

-- Pre-existing rows (none in production; a legacy import would carry
-- "Retraits en espèces" only) become withdrawals, which need no
-- counterpart — so the CHECK below validates on any existing data. The
-- default is then dropped: the API requires kind explicitly.
ALTER TABLE cash_entries
    ADD COLUMN kind text NOT NULL DEFAULT 'withdrawal',
    ADD COLUMN counterpart_account_id uuid REFERENCES accounts(id),
    ADD COLUMN reference text;
ALTER TABLE cash_entries ALTER COLUMN kind DROP DEFAULT;
ALTER TABLE cash_entries ADD CONSTRAINT cash_entries_kind_known
    CHECK (kind IN ('withdrawal', 'deposit', 'other_in', 'other_out'));
-- NOT VALID: enforced for every new/updated row, never a reason for the
-- migration to abort on a legacy row with a signed amount.
ALTER TABLE cash_entries ADD CONSTRAINT cash_entries_amount_positive CHECK (amount > 0) NOT VALID;
ALTER TABLE cash_entries ADD CONSTRAINT cash_entries_counterpart_when_other
    CHECK (kind IN ('withdrawal', 'deposit') OR counterpart_account_id IS NOT NULL);
CREATE INDEX cash_entries_date_idx ON cash_entries (entry_date DESC) WHERE deleted_at IS NULL;

-- No new grant: cash_entries and accounts are already granted to erp_app
-- for SELECT, INSERT, UPDATE; retirement is deleted_at, never DELETE.

COMMIT;
