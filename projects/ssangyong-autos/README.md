# SsangYong Parts — SSANGYONG.AUTOS

**Product:** SsangYong Parts
**Domain:** ssangyong.autos
**Repository:** othoth77/mythos-prod (`projects/ssangyong-autos/`)
**Current stage:** SYA-SHOP-2 — storefront redesigned as a professional parts-commerce UI (2026-08-26)
**Consumption architecture:** migration plan §22 **option 3 ratified 2026-08-16** — new storefront consumes the catalog natively; legacy site untouched, retired later
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
| `reference/shop.html` · `shop.css` · `shop-ui.js` | Storefront (SYA-SHOP-1), served by the same process |
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

## The architectural decision — RATIFIED 2026-08-16: §22 option 3

The migration plan §22 listed three ways the catalog could reach a shopfront and
declined to choose between them — *"options, not decisions … decide
post-migration"*. **The owner has now decided. Option 3 is ratified:**

> **3. New storefront consumes Mythos natively; legacy site retired later.**

Options 1 (the legacy website reads this API directly) and 2 (a scheduled
Postgres → MariaDB export) are **rejected**, and with them everything they would
have required: the legacy MariaDB site is *not* unfrozen, *not* edited, and *not*
written to. §21's freeze therefore stands unchanged and permanently for this
workstream, rather than being a temporary state awaiting this decision.

What the ratification settles:

| Question | Answer |
|---|---|
| Source of truth | PostgreSQL `ssangyong_autos`. No replica, no export, no second copy. |
| Consumer | A new storefront in this repository, consuming `reference/api.js` natively. |
| Legacy `/var/www/ssangyong.autos` | Untouched. Retired later, on its own owner order — retirement is **not** part of this workstream. |
| Public API exposure | **Not required by this option.** The storefront and API are the same process on the same host, so the API stays loopback-only until a deployment stage says otherwise. |

SYA-API-1 had deliberately built only what all three options shared. That bet
held: nothing built there needs revisiting under option 3.

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
env SSANGYONG_DB_HOST=... ... node tests/sya-api-1-readonly-catalog-api-test.js   # 60 checks
env SSANGYONG_DB_HOST=... ... node tests/sya-shop-1-storefront-test.js            # 39 checks
```

Neither suite is offline: both run real HTTP requests against the real catalog,
because proving this works against the live database is the point. The row
counts they assert are the Stage 5 Phase 3 baseline — if they fail, the data
changed.

---

## The storefront (SYA-SHOP-1, redesigned in SYA-SHOP-2)

The consumer ratified option 3 calls for. Served by the same process as the API
at `/`, so page and data share an origin and the API needs no public exposure of
its own. Same no-build-step, no-framework convention as
`projects/idauto/reference/admin.html` — plain HTML, one stylesheet, one script.

**SYA-SHOP-2 (2026-08-26)** rebuilt the UI as a real parts-commerce platform on
a design system branched from the MYTHOS token ARCHITECTURE
(`docs/design/DESIGN_TOKENS.md` — three tiers, 4px spacing scale, measured
contrast, one scarce accent) with this project's own identity (technical slate +
signal orange, light-first, per A-006 project independence):

- **Home** — hero with three discovery modes (vehicle finder, OEM reference,
  browse), model cards, brand strip, data-honest trust blocks, assistance CTA.
- **Catalogue** — PLP with vehicle / availability / brand filters, sort
  (`price_asc`/`price_desc`/`recent`), grid/list toggle, mobile filter drawer,
  and an empty state that always offers a recovery path.
- **Product** — gallery, buy panel, OE references, specs, fitment table with a
  data-backed *"Compatible avec votre véhicule"* badge (the ?model/?motor
  context survives into the product URL and is compared against catalogue ids,
  never guessed).
- **Models / Assistance** views, breadcrumbs, SEO metadata, skip link, focus
  states, 44px touch targets.
- **WhatsApp is architected but gated**: the catalogue holds no contact number
  and none is invented. Every WhatsApp control ships hidden behind
  `CONTACT.whatsapp = ''` at the top of `shop-ui.js`; the owner sets the real
  number there and every CTA (floating button, product, empty state,
  assistance) activates with context-prefilled messages.
- **No category tree** — deliberately. `database/schema.sql` §6 still holds:
  the scraped categories tab is a crawl frontier, not application data, so
  discovery is vehicle-first + OEM reference + brand, which the catalog truly
  supports.

The API gained three additive, whitelisted features for this stage —
`GET /api/availabilities`, `?availability=` and `?sort=` on `/api/products`
(default order unchanged).

| Route | Serves |
|---|---|
| `GET /` · `GET /index.html` | `shop.html` — the storefront shell |
| `GET /shop.css` | Stylesheet |
| `GET /shop-ui.js` | The UI |

**Browse model is vehicle-first**, because that is what the catalog actually
holds: pick a SsangYong model, then its motorization, then filter by part brand
or search by reference / designation / OE number. There is no category tree —
`database/schema.sql` §6 explains why the scraped `categories` tab is a crawl
frontier rather than application data, so building a browse tree on it would
have meant inventing one.

State lives in the query string (`?p` / `?model` / `?motor` / `?brand` / `?q` /
`?page`), so a filtered catalogue and a product page are both linkable and the
back button behaves.

Two constraints worth keeping if you extend it:

- **Never assign `innerHTML` with catalog data.** Every title, criterion and
  spec label came from a scraped third-party site. The UI builds nodes and sets
  `textContent`; a test asserts `innerHTML` appears nowhere, so a crafted
  product title cannot become markup.
- **Format prices from the decimal string, never `parseFloat`.** `money()`
  splits on the decimal point so the displayed value is byte-identical to the
  `NUMERIC(8,2)` the database holds. A test pins this against live data.

The page sends a default-deny CSP with exactly one remote origin —
`https://autopart.tn`, where the product photography lives. A test proves from
live data that this origin is both necessary and sufficient, so a future scrape
introducing a second image host fails loudly instead of silently showing broken
images.

**Ordering is not implemented and is not an oversight.** There is no order,
customer or payment table in the schema, and adding one would be inventing
architecture rather than consuming the catalog. The footer says so plainly:
*"Consultation seule. La commande n'est pas encore disponible en ligne."*

---

## Deferred, documented, not built

- `sya_product_price_history` — designed in `database/schema.sql` §7, to be
  created when re-scrape cadence justifies it.
- Part categories as a table — `database/schema.sql` §6 explains why the Sheets
  `categories` tab is a crawl frontier rather than application data, and that a
  browse tree should be added when a storefront actually needs one.
- Public exposure, TLS, rate limiting, caching — a deployment stage under
  ratified option 3, on its own owner order. Option 3 does not require exposing
  the API itself, only whatever serves the storefront.
- Retirement of the legacy `/var/www/ssangyong.autos` site — explicitly *"later"*
  in the ratified option, and its own owner order. Not this workstream.
