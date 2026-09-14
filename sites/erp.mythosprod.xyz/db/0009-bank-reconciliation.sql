-- 0009-bank-reconciliation.sql — Phase 3 (P1 Bank Transactions + Reconciliation):
-- give bank_entries the columns it needs to be a real, workable feature.
--
-- bank_entries has existed since schema.sql (Stage 3, "legacy mp_bank_entries")
-- with exactly the shape this phase needs: tenant-scoped, RLS-enabled,
-- account_id -> bank_accounts, entry_date, label, amount (signed: credit
-- positive), a reconciled boolean, and a unique (tenant_id, legacy_id) index
-- for import idempotency. It was defined but never wired to any handler,
-- route, or UI. This migration REUSES it rather than creating a second
-- "bank transaction" table — two tables representing the same concept (a
-- bank statement line) would be exactly the architectural confusion this
-- phase is required to avoid. The unused `reconciled` boolean is left in
-- place (harmless, still unreferenced by application code); `status` below
-- is the single source of truth for reconciliation state, since a boolean
-- cannot express the three real states (unmatched/matched/ignored).
--
--   1. bank_entries.status — unmatched (default) | matched | ignored. A bank
--      transaction starts unmatched; a human either matches it to an
--      existing payment or ignores it. Nothing here posts or reverses
--      accounting: the journal entry for money moving already exists,
--      created when the payment itself was recorded (accounting.js's
--      postPayment / postSupplierPayment). Reconciliation only records
--      which external statement line corresponds to which already-posted
--      payment — see modules/bank.js's own header comment for the full
--      rationale.
--   2. bank_entries.matched_payment_id / matched_at / matched_by — who this
--      transaction is matched to, and when/by whom. A CHECK keeps status and
--      matched_payment_id from drifting apart at the database level, not
--      just in application code (bank_entries_match_consistency).
--   3. A partial UNIQUE index on matched_payment_id enforces "one payment,
--      at most one matching bank transaction" as a database constraint, so a
--      race between two concurrent match attempts on the same payment
--      cannot both succeed — the second hits a unique-violation, not a
--      silent double-match.
--   4. account_id becomes NOT NULL: a bank transaction with no bank account
--      is not a usable record for reconciliation. Safe today — bank_entries
--      has zero rows in production (it was never wired to anything that
--      could write to it).
--
-- Reversible: DROP the four new columns, their CHECK and unique index, drop
-- bank_entries_status_idx, and restore account_id nullable — safe only if no
-- bank_entries row exists yet, true at the point this migration is written.

BEGIN;

ALTER TABLE bank_entries
    ADD COLUMN status text NOT NULL DEFAULT 'unmatched',
    ADD COLUMN matched_payment_id uuid REFERENCES payments(id),
    ADD COLUMN matched_at timestamptz,
    ADD COLUMN matched_by uuid REFERENCES users(id);

ALTER TABLE bank_entries
    ADD CONSTRAINT bank_entries_status_known
    CHECK (status = ANY (ARRAY['unmatched', 'matched', 'ignored']));

ALTER TABLE bank_entries
    ADD CONSTRAINT bank_entries_match_consistency
    CHECK ((status = 'matched') = (matched_payment_id IS NOT NULL));

ALTER TABLE bank_entries
    ALTER COLUMN account_id SET NOT NULL;

CREATE UNIQUE INDEX bank_entries_matched_payment_key
    ON bank_entries (matched_payment_id) WHERE matched_payment_id IS NOT NULL;

CREATE INDEX bank_entries_status_idx ON bank_entries (status) WHERE deleted_at IS NULL;

-- No new grant: erp_app already holds SELECT, INSERT, UPDATE on every table
-- from the original blanket provisioning grant, and bank_entries is never
-- DELETE-d (soft-delete via deleted_at, same convention as every other
-- business table).

COMMIT;
