-- 0007-quote-lines-grant.sql — grant erp_app the same DELETE it already has
-- on invoice_lines, extended to quote_lines (MVP quotes module).
--
-- quote_lines has existed since schema.sql (Stage 3), but nothing ever wrote
-- to it: the generic resource layer only ever managed the `quotes` header
-- row. The blanket `GRANT SELECT, INSERT, UPDATE ON ALL TABLES` issued at
-- provisioning time already covers quote_lines for those three verbs — this
-- migration adds only the one privilege that grant deliberately excludes.
--
-- Same shape as invoice_lines' own grant: a quote's lines are replaced
-- wholesale on edit (DELETE the old set, INSERT the new one, inside the same
-- transaction as the header UPDATE — see modules/quotes.js's replaceLines),
-- exactly the pattern invoice_lines already has DELETE for. No new column,
-- no new table, no data touched — a single privilege grant on an existing
-- table to the existing runtime role.
--
-- Reversible: REVOKE DELETE ON quote_lines FROM erp_app; — restores the
-- pre-migration state exactly (erp_app keeps SELECT/INSERT/UPDATE from the
-- original blanket grant either way).
--
-- Applied by api/migrations/migrate.js as erp_owner after 0006.
BEGIN;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') THEN
    GRANT DELETE ON quote_lines TO erp_app;
  END IF;
END $$;

COMMIT;
