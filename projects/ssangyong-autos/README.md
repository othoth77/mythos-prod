# SsangYong Parts — SSANGYONG.AUTOS

**Product:** SsangYong Parts
**Domain:** ssangyong.autos
**Repository:** othoth77/mythos-prod (`projects/ssangyong-autos/`)
**Current stage:** SYA-API-1 — read-only catalog API over the live PostgreSQL catalog (2026-08-16)
**Authoritative state record:** `docs/AI_HANDOVER.md`

---

## What exists today

| Layer | State |
|---|---|
| `database/schema.sql` | **Deployed** — 5 `sya_*` tables + 8 explicit indexes, schema `ssangyong_autos` |
| `database/migration/` | **Executed** — import committed, `validation.sql` 18/18 checks pass |
| Live catalog | **1519 rows** — 346 products · 17 vehicle models · 63 motorizations · 782 compatibility · 311 images |
| `reference/db.js` | Read-only `pg` pool over the live database |
| `reference/api.js` | GET-only HTTP catalog API (SYA-API-1) |
| Public exposure | **None.** Loopback-only, not deployed, no nginx block, no service unit |

The database is `ssangyong_autos` on PostgreSQL 15.18 at `127.0.0.1:5432`, owned by
the dedicated non-superuser role `ssangyong_autos_owner`. It is a separate
database from `idauto` and shares nothing with it.

---

## Two systems called "ssangyong.autos" — do not confuse them

This is the single most important fact for anyone picking this project up.

| | **This project** | **The legacy site** |
|---|---|---|
| Location | `projects/ssangyong-autos/` (this repository) | `/var/www/ssangyong.autos/` (not in any repository) |
| Database | PostgreSQL `ssangyong_autos`, tables `sya_*` | MySQL/MariaDB, tables `models` / `categories` / `subcategories` / `products` / `product_images` |
| Data | 346 canonical parts scraped from autopart.tn, with vehicle fitment | Hand-entered stock managed through `/pro/*.php` |
| API | `reference/api.js` (this stage) | `api/catalog.php` |
| Served at | nowhere yet | `https://ssangyong.autos` |

They have different data models, different databases, and different lifecycles.
`MYTHOS_SSANGYONG_DATA_MIGRATION_AND_RESUME_PLAN.md` §21 freezes the legacy
site for this workstream — *"no reads/writes/schema changes"*, and *"Mythos is a
separate system (Postgres) with no coupling to the MariaDB website."* Nothing in
this directory opens a MySQL connection or reads a legacy file, and a test
asserts that it stays that way.

---

## The open architectural decision (owner)

How the catalog reaches a shopfront is **not decided**. The migration plan §22
lists three options and says so explicitly — *"options, not decisions … decide
post-migration"*:

1. The legacy website reads this API directly.
2. A scheduled Postgres → MariaDB export, with Postgres as source of truth.
3. A new storefront consumes the catalog natively; the legacy site is retired later.

SYA-API-1 deliberately builds only what **all three** need: a correct, read-only
layer over the live catalog. It does not choose between them, and it couples to
neither site. Choosing — and any public exposure that follows — is an owner
decision and its own stage.

---

## The API (SYA-API-1)

GET-only. No authentication, matching the contract the existing storefront API
already states for itself and justified by the data: public catalogue rows, no
PII column, no secret column (`database/schema.sql`: *"No secret-value columns.
No PII columns."*). Read-only is enforced by PostgreSQL itself — every
connection opens with `default_transaction_read_only=on`, so a write is refused
with `25006` no matter what a caller asks for.

| Route | Returns |
|---|---|
| `GET /api/health` | Database identity, the read-only flag, and live row counts |
| `GET /api/vehicle-models` | All 17 models with motorization and product counts |
| `GET /api/vehicle-models/:id/motorizations` | Motorizations of one model; `404` on an unknown model |
| `GET /api/brands` | Part-brand facet with counts |
| `GET /api/products` | Paged list — `q`, `brand`, `model_id`, `motorization_id`, `limit` (≤200), `offset` |
| `GET /api/products/:product_uid` | One product with its images and vehicle fitments |

Conventions worth knowing before extending it:

- **Products are addressed by `product_uid`** (`autopart.tn:<fiche-id>`), never by
  the `BIGSERIAL` id, which is never serialised. `database/schema.sql` sets this
  rule: *"external systems never depend on the serial value."*
- **`price_tnd` is returned as the exact `NUMERIC(8,2)` decimal string**, not a
  float. Parse it at the point of display rather than adding a rounding step the
  database does not have.
- **"In the catalogue" means `status IN ('active','updated')`.** `updated` is a
  re-scrape state, not a withdrawal; only `inactive` and `delisted` are withheld.
  The live data is 344 `active` + 2 `updated`, so filtering on `active` alone
  silently loses two sellable parts. That predicate is defined once in `api.js`
  (`LIVE_STATUS`) and used by every count and every page, so a facet can never
  disagree with the list it describes.

### Run it

```bash
env SSANGYONG_DB_HOST=... SSANGYONG_DB_PORT=... SSANGYONG_DB_USER=... \
    SSANGYONG_DB_PASSWORD=... SSANGYONG_DB_NAME=... \
    node projects/ssangyong-autos/reference/api.js
```

Binds `127.0.0.1:3011` (`SSANGYONG_API_PORT` to override). Operational
credentials live at `/home/deploy/deployments/ssangyong-autos-postgres/.env`
(mode `0600`, outside the repository — never commit them, never print them).

### Test it

```bash
env SSANGYONG_DB_HOST=... ... node tests/sya-api-1-readonly-catalog-api-test.js
```

Not offline: it runs real HTTP requests against the real catalog, because
proving the API works against the live database is the point. The row counts it
asserts are the Stage 5 Phase 3 baseline — if they fail, the data changed.

---

## Deferred, documented, not built

- `sya_product_price_history` — designed in `database/schema.sql` §7, to be
  created when re-scrape cadence justifies it.
- Part categories as a table — `database/schema.sql` §6 explains why the Sheets
  `categories` tab is a crawl frontier rather than application data, and that a
  browse tree should be added when a storefront actually needs one.
- Public exposure, TLS, rate limiting, caching — all belong to whichever §22
  option the owner chooses.
