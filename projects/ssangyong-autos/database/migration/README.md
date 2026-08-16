# SSANGYONG.AUTOS — Stage 4 migration artifacts

**STATUS: DRY-RUN — NOT EXECUTED — NOT DEPLOYED.**
No database connection was used to produce anything in this directory. No
table exists. No row has been inserted anywhere. Executing `import.sql` is
Stage 5 work and requires explicit owner authorisation.

## Contents

| Path | Role |
|---|---|
| `input/*.csv` | The validated Stage 2 read-only dry-run dataset (346 canonical products, 782 compatibility relationships, 311 images) plus the `models` (17) and `motorizations` (63) tabs extracted from the same workbook snapshot of Google Sheet `1T0dyVeNrToy5bhLJ5Sh6_gM_WMAGJBS6s2VBzWa2Id0`. Frozen input — regenerating it means re-running the Stage 2 audit, not editing these files. |
| `generate_import.py` | Deterministic generator (stdlib-only Python). Same input bytes ⇒ same output bytes, proven by SHA-256 across runs. Fails hard — non-zero exit, no output written — on any count mismatch, duplicate identity, orphan reference, CHECK-constraint or type violation. Never connects to a database. |
| `import.sql` | Transaction-wrapped (`BEGIN`…`COMMIT`) INSERTs for the five `sya_` tables with explicit deterministic ids (sorted natural keys: `product_uid`, `model_url`, `motorisation_url`) and `setval()` sequence realignment. External identity is the site-native `product_uid` = `autopart.tn:<fiche-id>` — no invented SKUs, no random UUIDs. |
| `validation.sql` | Read-only post-import assertions: exact row counts, uniqueness (product_url, business identity, compatibility key, product/image), all FK orphan checks, date-shaped motorisation refusal, price range. Every row must report `pass = true`. |

## Verified in this dry-run (2026-08-16)

- Counts: products **346** · vehicle_models **17** · vehicle_motorizations **63** · compatibility **782** · images **311**; 35 products legitimately have no images.
- Referential integrity: 0 orphans; all 782 compatibility rows resolve product **and** model, and all 782 also safely resolve `vehicle_motorization_id` via the site motor-id URL suffix (0 NULL FKs).
- Constraint simulation: 0 duplicate identities, 0 CHECK violations, 0 invalid JSON, 0 invalid timestamps, 0 invalid prices, all VARCHAR length limits respected.
- The 17 date-coerced motorisation labels in the `motorizations` tab were repaired by the same URL-slug rule validated in Stage 2, and compat labels were cross-checked against the repaired tab labels (0 mismatches).
- SQL grammar: both files parse with libpg_query (pglast) — `import.sql` = 12 statements (2 transaction, 5 INSERT, 5 setval SELECT), `validation.sql` = 1 SELECT.
- **PostgreSQL execution: NOT PERFORMED.** Parse-level validation only; no server was reachable or contacted.

## Stage 5 order of operations (requires explicit authorisation)

1. Create schema + tables from `../schema.sql` (uncomment `CREATE SCHEMA`, set search_path).
2. Run `import.sql` inside its transaction.
3. Run `validation.sql`; abort/rollback unless every check passes.
