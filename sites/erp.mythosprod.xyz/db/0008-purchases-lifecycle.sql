-- 0008-purchases-lifecycle.sql — Phase 2 (P1 Purchases): give purchases a
-- real lifecycle and let the existing payments table settle them.
--
-- Purchases has been a flat record since schema.sql (Stage 3, "legacy
-- mp_purchases"): supplier, reference, date, amount_ht, vat_rate, notes.
-- Never a status, never payable, never touched by accounting. This migration
-- adds exactly what the lifecycle needs and nothing else — no lines table
-- (a purchase already carries a single amount_ht/vat_rate pair, which is
-- already the simplest coherent model for a supplier document; invoices'
-- per-line model exists because a customer invoice is itemised, a purchase
-- record here is not).
--
--   1. purchases.status — mirrors invoices' own pattern exactly: a human
--      sets draft/confirmed/cancelled, and paid/part_paid are DERIVED from
--      payments (see modules/purchases.js's reconcileStatus, a direct port
--      of invoices.js's own function). Existing rows are backfilled to
--      'confirmed' — they already represent real, settled purchase records
--      predating this column; defaulting them to 'draft' would misstate
--      them as not-yet-confirmed. New rows default to 'draft', same as new
--      invoices.
--   2. purchases.due_on — optional, mirrors invoices.due_on. Nullable: most
--      of Tunisia's small-business purchases have no formal payment term.
--   3. payments.invoice_id becomes nullable and payments.purchase_id is
--      added, with a CHECK that exactly one of the two is set. This is the
--      same generalisation invoices' own accounting linkage already uses
--      (journal_entries.source_table/source_id is untyped by design) — a
--      payment settles exactly one document, sales-side or purchase-side,
--      never neither and never both. No new payments table: this is the
--      existing one, extended.
--
-- Reversible: DROP the two purchases columns and their CHECK, drop
-- payments.purchase_id and its CHECK, and restore payments.invoice_id NOT
-- NULL (safe only if no purchase payment rows exist yet — true at the point
-- this migration is written, production purchases is empty).

BEGIN;

ALTER TABLE purchases
    ADD COLUMN status text NOT NULL DEFAULT 'draft',
    ADD COLUMN due_on date;

ALTER TABLE purchases
    ADD CONSTRAINT purchases_status_known
    CHECK (status = ANY (ARRAY['draft', 'confirmed', 'part_paid', 'paid', 'cancelled']));

-- Every row that already exists at this point predates the column: it is a
-- real purchase already on the books, not a draft someone is mid-typing.
UPDATE purchases SET status = 'confirmed';

CREATE INDEX purchases_status_idx ON purchases (status) WHERE deleted_at IS NULL;

ALTER TABLE payments
    ALTER COLUMN invoice_id DROP NOT NULL,
    ADD COLUMN purchase_id uuid REFERENCES purchases(id);

ALTER TABLE payments
    ADD CONSTRAINT payments_exactly_one_target
    CHECK ((invoice_id IS NOT NULL) <> (purchase_id IS NOT NULL));

CREATE INDEX payments_purchase_idx ON payments (purchase_id) WHERE purchase_id IS NOT NULL;

-- No new grant: purchases is retired the same way invoices is (UPDATE
-- deleted_at/status), never DELETE-d, and erp_app already holds SELECT,
-- INSERT, UPDATE on every table from the original blanket provisioning
-- grant. payments likewise needs no new grant for the same reason.

COMMIT;
