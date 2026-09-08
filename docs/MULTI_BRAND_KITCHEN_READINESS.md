# Multi-brand Kitchen readiness

**Question:** what must change for the Kitchen to serve a genuinely multi-brand
catalog, and what is actually blocking it?

**Answer, in one line:** after SYA-API-2 the *architecture* is ready and the
*data* is not, and the thing standing between them is a signature, not an
engineering task.

---

## 1. Current — measured 2026-09-08

| Dimension | Reality |
|---|---|
| Vehicle brands | **1** (`SSANGYONG`, all 17 models) |
| Vehicle models | 17 · motorizations 63 · fitment edges 782 |
| Products | 346, all `source = 'autopart.tn'` |
| Part brands | 44 in the live facet |
| Part categories | **no dimension exists** |
| Brand facet / filter | **present** (SYA-API-2) |
| Batch quotes | **present** (SYA-API-2) |
| Search | `ILIKE`, adequate at this size (1.7 ms) |
| Stock quantity | none — availability is a state |
| Orders / customers | none |

## 2. Required for multi-brand, and its status

| Capability | Status | Note |
|---|---|---|
| `brand_car` on the vehicle model | **READY** | column already exists; nothing to migrate |
| Brand facet endpoint | **READY** | `/api/vehicle-brands` |
| Brand filter on products | **READY** | via the fitment edge |
| Brand filter on models | **READY** | optional parameter |
| Model / motorisation / fitment shape | **READY** | brand-agnostic already; nothing is SsangYong-specific in the schema |
| Product identity | **READY** | `product_uid` is `<source>:<id>`, so a second source coexists without collision |
| Multi-source products | **READY-ish** | `source` column exists and the business key is `(source, product_brand, canonical_reference)`. A second source inserts without schema change |
| Images | **READY** | per-product rows, `^https://` constrained |
| Price / availability | **READY** | per product |
| **Part categories** | **BLOCKED — owner decision** | §4 |
| **Search at scale** | **DEFERRED, measured** | `pg_trgm` available but not installed; revisit at ~10⁵ rows |
| **Pagination at scale** | **DEFERRED, measured** | OFFSET over a total order; revisit with search |
| **The data itself** | **BLOCKED — owner action O8** | §3 |

**Nothing in the schema is single-brand.** `sya_vehicle_models.brand_car` is a
plain column that happens to hold one value. The catalog is single-brand because
of what was ingested, not because of how it was designed.

## 3. The actual blocker — owner action O8

`autopart.tn/robots.txt`, verbatim:

> Automated collection of catalogue, pricing and vehicle-compatibility data is
> prohibited without prior written authorisation from AutoPart Tunisie.

The host also serves `403` to an ordinary client. OTHKM records the
authorisation as **not obtained**, and that *"AUTOS-0 must not start before owner
actions O1, O4/O5 and O8 are closed."*

**Nothing in this work collected anything.** No scraper was written, none was
run, no bulk fetch was made, no 403 was circumvented. The existing frontier and
existing catalog were read as evidence only.

**Consequence for language:** while O8 is open, no document in this estate may
describe Piece.Autos or the Kitchen as multi-brand *in production*. The correct
terms are **ARCHITECTURALLY READY** and **OWNER-GATED**.

## 4. KG-2 — part categories, and why the 390 slugs are not the answer

SPY holds **45,036 distinct autopart.tn product URLs**, from which **390**
category slugs and **148** part-brand slugs are recoverable by URL shape
(45,000 parse; 36 do not).

**The frontier is not the catalog.** Those 390 are what a *sitemap* exposed, not
a curated dimension. Importing them as a category table would mean:

- adopting a third party's taxonomy, including its duplicates and near-synonyms
  (`amortisseur` and `amortisseur-suspension-de-la-cabine` are separate slugs);
- creating a dimension for 45,036 products of which the Kitchen holds 346;
- doing so from data whose collection is exactly what O8 gates.

**Options.**

| | Approach | Verdict |
|---|---|---|
| A | Import the 390 frontier slugs as a `sya_part_categories` table | **Reject.** Frontier ≠ catalog, and it is O8-encumbered |
| B | Derive the slug per product from `product_url` at read time; each channel groups slugs into its own presentation labels | **Adopted for now.** Costs nothing, invents nothing, and each storefront's grouping stays its own (contract §12). Piece.Autos does this, always keeping an explicit `unmapped` bucket so an incomplete mapping shows itself rather than hiding stock |
| C | A curated `sya_part_categories` table in the Kitchen, owner-approved, populated from whatever source O8 authorises | **The right end state**, once there is a catalog worth categorising |

**Owner decision required** before C: who authors the canonical category list,
is it flat or hierarchical, and is it stable across sources? A category id that
changes when the source changes is not an identity.

Until then the Kitchen exposes **no category dimension**, and that is recorded
as a gap rather than papered over with a derived one pretending to be canonical.

## 5. Introducing an authorised source without rewriting a storefront

The seam already exists and is exercised.

```
storefront ─► KitchenCatalogPort ─► adapter ─► catalog service ─► sya_* tables
                    │                                                  ▲
                    └── fixture adapter (synthetic, no third-party data)│
                                                                        │
   an authorised source lands HERE — as rows, under `source` ───────────┘
```

- **A second source** inserts alongside the first: `product_uid` is
  `<source>:<id>` and the business key includes `source`. No schema change.
- **Own inventory** is the same shape with `source = 'mythos'`.
- **A licensed provider** (TecDoc-class) is an ingestion concern, not a
  storefront one; the storefront still reads six routes.
- **The storefront changes nothing** in any of these cases. Piece.Autos proves
  this today by running identically against the live catalog and against a
  synthetic multi-brand fixture that contains no third-party data.

## 6. Risk

| Risk | Mitigation |
|---|---|
| Multi-brand claimed before O8 closes | Language rules in §3; `/api/vehicle-brands` reports what is present, so the claim is checkable |
| A second source collides with the first | Business key includes `source`; `product_uid` is namespaced |
| The 390 frontier slugs get imported as canonical | §4 records why not; `unmapped` bucket makes an incomplete mapping visible |
| Search degrades silently after ingestion | KG-6 deferral is measured, with a named revisit threshold (~10⁵ rows) |
| A storefront starts collecting on its own | Piece.Autos CI fails on a database client or a scraper-shaped dependency |
