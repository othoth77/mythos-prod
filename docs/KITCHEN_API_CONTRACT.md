# MYTHOS AUTO — Parts Network catalog API contract

**Service:** `projects/ssangyong-autos/reference/api.js`
**Contract stage:** SYA-API-3 (adds `/api/part-categories` and `?category=`)
**Shared Kitchen Contract:** consumers pin **1.2.0** (MINOR — additive only; §7)
**Status:** SYA-API-1 routes **LIVE** at `https://store.ssangyong.autos/api`.
SYA-API-2 routes are **implemented and live-verified on an isolated port, NOT DEPLOYED** — deployment is an owner/operator step (§8).

This document is generated from the code, not from intent. Every field below
was read out of `api.js` and confirmed against the live catalog on 2026-09-08.

---

## 1. Transport and global behaviour

| | |
|---|---|
| Methods | **GET only.** Any other verb on a known path → `405` with an `Allow` header |
| Auth | None. Public catalogue rows; the schema states *"No secret-value columns. No PII columns."* |
| Writes | **Impossible.** `db.js` opens every connection with `default_transaction_read_only=on`, so PostgreSQL refuses a write with `25006` regardless of caller |
| Bind | `127.0.0.1:3011`. Public exposure is nginx-only, `limit_except GET HEAD { deny all; }` |
| Success headers | `Content-Type: application/json; charset=utf-8`, `X-Content-Type-Options: nosniff`, `Cache-Control: public, max-age=60` |
| Error headers | `Cache-Control: no-store` |
| Errors | `{"error": "<message>"}`. `400` client input, `404` unknown route or product, `405` wrong verb, `500` `{"error":"internal error"}` — the driver message never leaves the process |
| SQL | Every value is a bound parameter. There is no string-interpolated user input anywhere |

**Caching caveat for consumers.** `max-age=60` applies to `/api/quotes` as it
does to everything else. A storefront revalidating a cart must send
`cache: "no-store"` (Piece.Autos does) so a shared cache cannot hand it a
minute-old price at checkout.

## 2. Endpoint matrix

### `GET /api/health`
Input: none. Response: `status`, `database`, `schema`, `read_only` (bool), `counts{products, vehicle_models, vehicle_motorizations, compatibility, product_images}`.
Live: `346 / 17 / 63 / 782 / 311`. Consumers: SsangYong storefront, Piece.Autos `describe()`, monitoring.

### `GET /api/vehicle-brands` — **NEW (SYA-API-2, KG-1)**
Input: none.
Response: `{ vehicle_brands: [{ brand_car, model_count, product_count }] }`, ordered by `brand_car`.
Live: `[{ SSANGYONG, 17, 346 }]`.
`product_count` counts distinct products reachable through a fitment edge, under `LIVE_STATUS`, so the facet agrees with `/api/products?brand_car=…` by construction — asserted by test.
**A facet over the existing `sya_vehicle_models.brand_car` column. No new table, no new taxonomy.**

### `GET /api/vehicle-models[?brand_car=…]`
`brand_car` is **optional and additive**; case-insensitive; max 64 chars (`400` beyond). Omitting it returns every model — byte-identical to pre-SYA-API-2, asserted by test.
Unknown brand → `200` with an empty list, **not** `404`.
Response rows: `id, brand_car, model_name, generation_code, year_from, year_to, model_url, motorization_count, product_count`.

### `GET /api/vehicle-models/:id/motorizations`
`404` on unknown model. Rows: `id, motorisation, year_from, year_to, power, fuel`.
`motorisation` is **text as published** (`"2.0 Xdi 4WD"`) and a `CHECK` refuses date-shaped values — a scar from a real Stage-2 corruption. Never parse it.

### `GET /api/brands`
The **part**-manufacturer facet (BOSCH, ASHIKA) — distinct axis from `vehicle-brands`. Rows: `product_brand, product_count`.

### `GET /api/products`
| Parameter | Rule |
|---|---|
| `q` | free text; `ILIKE '%q%'` over `product_title`, `canonical_reference`, `oem_reference` |
| `brand` | exact part brand |
| `model_id`, `motorization_id` | positive integers; `EXISTS` over fitment |
| `brand_car` | Case-insensitive vehicle manufacturer, via the fitment edge |
| `category` | **NEW (SYA-API-3).** Exact part-category slug; > 128 chars → `400`; empty is ignored; composes with every other filter |
| `limit` | 1–200, default 50; outside → `400` |
| `offset` | ≥ 0; negative → `400` |

Response: `{ total, limit, offset, products: [...] }` with `product_uid, product_brand, canonical_reference, product_title, oem_reference, availability, price_tnd, currency, product_url, last_checked_at, main_image_url`.
Order: `product_brand, canonical_reference` — **a total order** (346 rows, 346 distinct keys; guaranteed by `UNIQUE(source, product_brand, canonical_reference)` with `source` constant), so `OFFSET` paging cannot duplicate or skip.

### `GET /api/products/:product_uid`
Addressed by `product_uid` (`autopart.tn:<fiche-id>`), never the `BIGSERIAL`, which is deleted from the response. Raw and percent-encoded colons both work.
Adds `source, pair_reference, criteria_text, technical_specs, delivery_note, status, collected_at`, plus `images[]` and `compatibility[]`.
`404` on unknown uid — and consumers must not retry it: an answer is not an outage.

### `GET /api/part-categories` — **NEW (SYA-API-3, KG-2)**
Input: none. Response: `{ part_categories: [{ category_slug, product_count }] }`, ordered by slug.

The category is **derived from `product_url`**, whose shape is fixed by the source:
`/fiche/<category-slug>-<catId>/<brand-slug>-<brandId>/<ref>-<ficheId>.html`. It is a fact already
in the row, not a taxonomy invented here — **no new table, no DDL, no migration**.
Measured live: **346 of 346 products yield a slug, across 72 distinct values.**

Derived once, in `PART_CATEGORY`, for the same reason `LIVE_STATUS` is: a facet can never disagree
with the list it describes, and three consumers cannot drift into three slightly different regexes.
Implemented as `regexp_replace(split_part(product_url,'/',5),'-[0-9]+$','')` rather than a full-URL
regex match — identical output on all 346 rows (0 disagreements), at **~0.9 ms** against **28–48 ms**.

**This is not the 390-slug frontier.** That is a sitemap measurement of a source holding 45,036
products; importing it would create categories for products this catalog does not have. Only slugs
the live catalogue uses are reported, so **every category has at least one product** and no empty
page can be generated.

Slugs are returned raw. Grouping them into customer-facing families is presentation and belongs to
each storefront (shared contract §12).

### `GET /api/quotes?uids=a,b,c` — **NEW (SYA-API-2, KG-3)**
Price and availability for many products in one request, for cart/checkout revalidation.

| Rule | Behaviour |
|---|---|
| `uids` missing / empty / only separators | `400` |
| > 50 identifiers (`MAX_QUOTE_UIDS`) | `400` — a cart route, not a bulk export |
| identifier > 128 chars | `400` |
| repeated identifier | de-duplicated, order preserved, answered once |
| unknown / `inactive` / `delisted` | **named in `missing`**, never silently dropped |

Response: `{ requested, quotes: [{product_uid, canonical_reference, product_title, price_tnd, currency, availability, last_checked_at}], missing: [...], complete: bool }`.
`complete` exists so a consumer cannot mistake a partial answer for a whole one by reading `quotes` alone.
`price_tnd` is byte-identical to the product document — asserted by test.

**Measured, 5-line cart, live catalog, 20 runs:** 5 × `/api/products/:uid` = 29.53 ms, 5 requests, 15 queries, ~5570 B → 1 × `/api/quotes` = 2.05 ms, 1 request, 1 query, ~1166 B. **14.4× faster, 4.8× smaller.**

## 3. Deliberately absent

No order, customer, cart, stock-quantity, supplier, purchase-price or part-category route — because no such table exists. `availability` is a state (`En Stock` / `Sur Commande` / `Indisponible`), never a count.

## 4. Deferred with measurement, not with intent

| Gap | Evidence (live, 2026-09-08) | Decision |
|---|---|---|
| **KG-6** search | `sya_products` is **688 kB / 346 rows**; the 3-column `ILIKE` seq-scans in **1.7 ms**. `pg_trgm` is available but **not installed**, and installing it is production DDL needing superuser | **DEFER.** An index on a 688 kB table is maintenance cost the planner would likely decline. Revisit at ~10⁵ rows — i.e. after O8 |
| **KG-7** pagination | Sort key is unique across all 346 rows (346/346 distinct); deepest page (`OFFSET 336`) runs in **1.9 ms** | **DEFER.** OFFSET over a total order cannot duplicate or skip. Cursors solve a problem this catalog does not have |
| **KG-2** categories | The 390 slugs are a *frontier* measurement, not a curated catalog dimension | **OWNER DECISION.** See `MULTI_BRAND_KITCHEN_READINESS.md` |
| **KG-4** orders | No table, no write path | Out of scope for a read API. Storefronts own channel orders provisionally |
| **KG-5** stock | Not modelled anywhere | Not a gap to close by inventing a number |

## 5. Compatibility

**Every SYA-API-2 and SYA-API-3 change is additive.** Verified by diffing all responses between the deployed service and the candidate across 20 request shapes (plus 6 more comparing SYA-API-3 against the SYA-API-2 candidate: **26/26 identical**) — existing routes, filters, paging, encodings, `400`/`404`/`405` cases: **20/20 byte-identical**. Storefront assets (`/`, `/index.html`, `/shop.css`, `/shop-ui.js`) hash-identical.

`shop-ui.js` calls `/api/health`, `/api/vehicle-models`, `/api/brands`, `/api/products` — all unchanged.

## 6. Tests

`tests/sya-api-1-readonly-catalog-api-test.js` — **110 checks** (60 → 94 → 110). `tests/sya-shop-1-storefront-test.js` — **41 checks**, unchanged. Both run real HTTP against the live read-only catalog.

## 7. Versioning

`KITCHEN_CONTRACT_VERSION` **1.0.0 → 1.1.0** (SYA-API-2) **→ 1.2.0** (SYA-API-3). Both MINOR. Adding a value or a route is MINOR; removing or renaming is MAJOR.
Old behaviour: no brand facet, no brand filter, no batch quote. New: all three, additive. A 1.0.0 consumer keeps working unchanged; a 1.1.0 consumer may use the new routes. **Rollback:** revert the commit; nothing persisted changed, and no migration ran.

## 8. Deployment — NOT DONE

The live service still runs SYA-API-1 from `/home/deploy/projects/mythos-prod`. Deploying SYA-API-2 means restarting `ssangyong-storefront`, which is an **owner/operator step**. No DDL, no migration, no data change is required — the new routes read existing columns and existing indexes.
