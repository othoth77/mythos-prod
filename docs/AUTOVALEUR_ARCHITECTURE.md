# AutoValeur — Architecture

**Stage:** AVA-0 Foundation and Ecosystem Roadmap (amended by ATN-0)
**Last updated:** 2026-08-05
**Platform:** Mythos ecosystem
**Repository:** othoth77/mythos-prod

---

## 1. Product Position

AutoValeur is a vehicle valuation and market intelligence product within the Mythos ecosystem. It is a **distinct product domain** with its own PostgreSQL schema (`autovaleur`), its own lifecycle, and its own legal and commercial obligations.

AutoValeur does not own vehicle identity data. It consumes vehicle identity from ID Auto. It does not own inspection and repair data. It consumes that from the Atelier Network (first provider: Fixpert). It does not own marketplace data. It consumes that from authorised external sources.

AutoValeur owns:
- Valuation records (immutable snapshots)
- Comparable analysis results
- Condition report inputs (from users)
- Repair estimate records (authorised references only)
- Liquidity and opportunity scores
- Deal pipeline records (MYTHOS_PRIVATE)
- Model versions and evaluation records
- Source catalogue
- Audit events

---

## 2. Target Database Architecture

**Target DBMS: PostgreSQL** — selected as the target for the full Mythos ecosystem.

**Status: NOT INSTALLED OR DEPLOYED.** PostgreSQL is not present in AVA-0. The `projects/autovaleur/database/schema.sql` file is a draft specification only.

```
PostgreSQL cluster (target — not yet deployed)
├── mythos_core schema
│   └── users, global roles, permissions, global audit, platform administration
│
├── idauto schema
│   └── vehicles, plates, observations, facts, evidence, captures, ...
│
├── atelier_network schema
│   └── workshop registry, inspections, repair estimates, AutoCheck reports (DRAFT)
│
├── fixpert schema (external — not created by this repository)
│   └── clients, work orders, interventions, invoices, payments, ...
│
└── autovaleur schema
    └── valuations, valuation inputs, market listings, comparables,
        condition reports, repair estimates, parts quotes,
        liquidity scores, opportunity scores, deal alerts,
        deal pipeline, transactions, model versions,
        model evaluations, source catalogue, audit events
```

---

## 3. Architecture Decisions

### AD-A1 — Valuation snapshots are immutable

**Decision:** Once a valuation is created, its result fields are never modified. A new valuation request produces a new record. Historical valuations retain their original inputs, model version, and result fields permanently.

**Why:** Valuation accuracy can only be measured by comparing predictions against later outcomes. Overwriting historical valuations would destroy the feedback loop needed to improve the model.

**Enforcement:** Application code must use INSERT for new valuations. The `autovaleur_valuations` table has no UPDATE path in the production API.

---

### AD-A2 — Model version is mandatory on every result

**Decision:** Every valuation record, comparable analysis, and model evaluation must include the `model_version` field. Every change to valuation rules, weights, or comparable selection logic increments the model version.

**Why:** Without model versioning, it is impossible to audit why a valuation produced a specific result, or to compare performance across rule changes.

**Enforcement:** `autovaleur_valuations.model_version` is NOT NULL. Deployment of a new model version requires a new record in `autovaleur_model_versions`.

---

### AD-A3 — Asking price and completed sale price are always separate fields

**Decision:** `asking_price` and `completed_sale_price` are always stored as separate, distinct fields. Asking prices and completed sale prices are never merged, averaged, or conflated.

**Why:** Asking prices reflect seller expectations; completed sale prices reflect realised market value. Mixing them would systematically overestimate market values and destroy the model's accuracy.

**Enforcement:** `autovaleur_market_listings` has separate `asking_price` and `accepted_offer_price` and `completed_sale_price` columns. Application code must never copy asking_price into completed_sale_price without an explicit transaction record.

---

### AD-A4 — No duplication of ID Auto vehicle facts

**Decision:** AutoValeur stores a snapshot reference to ID Auto vehicle data at the time of valuation (vehicle_id and a JSON snapshot of key facts used). It does not maintain a synchronised copy of ID Auto vehicle records.

**Why:** Maintaining a live copy of ID Auto data would create divergence, stale data risks, and potential privacy violations if ID Auto facts are later corrected or restricted.

**Enforcement:** `autovaleur_valuations.idauto_snapshot_json` contains the facts used at valuation time, clearly labelled as a snapshot. The `idauto.vehicles.id` is stored as a foreign reference.

---

### AD-A5 — No duplication of workshop customer PII or marketplace seller PII

**Decision:** AutoValeur stores only stable IDs and authorised references to Atelier Network and marketplace data. Customer names, contacts, and financial records are never copied into the `autovaleur` schema.

**Why:** Each workshop organisation owns its customer and financial records. Marketplace platforms own their seller and transaction records. Cross-schema PII duplication creates compliance exposure.

**Enforcement:** `autovaleur_repair_estimates` stores `inspection_provider_id` and `repair_estimate_id` (stable IDs from Atelier Network). `autovaleur_transactions` stores `marketplace_listing_ref` (stable ID). No customer PII columns exist in any `autovaleur_` table.

---

### AD-A6 — Source provenance is mandatory

**Decision:** Every market listing, comparable, parts quote, and transaction record must reference its `source_id` in `autovaleur_source_catalogue`. No data without a known, documented source is admitted.

**Why:** Without source provenance, it is impossible to audit data quality, apply source trust scores, or comply with marketplace terms. Untracked data is unauditable data.

---

### AD-A7 — Deal Radar is MYTHOS_PRIVATE by design

**Decision:** All deal alert records, deal pipeline entries, and opportunity acquisition data are stored with `access_scope = 'mythos_private'`. They are never returned in public or professional API responses.

**Why:** Deal alerts expose Mythos acquisition strategy. Professional subscribers and public users must not be able to infer Mythos business intentions from API responses.

**Enforcement:** `autovaleur_deal_alerts` and `autovaleur_deal_pipeline` have no public or professional API endpoint. Access requires `MYTHOS_SUPER_ADMIN` role with audit logging.

---

### AD-A8 — All Mythos Super Admin access is audit-logged

**Decision:** Every access by a Mythos Super Admin to AutoValeur data — including read access — is recorded in `autovaleur_audit_events` with actor reference, target, and timestamp.

**Why:** Super Admin access includes sensitive business intelligence (acquisition prices, margins, deal pipeline). Audit logging is the accountability mechanism.

---

## 4. Integration Contracts

All integrations are **disabled** in AVA-0. They activate in AVA-1 and later.

### 4.1 ID Auto (`idauto schema`)

| Contract point | Detail |
|---|---|
| Purpose | Vehicle identity lookup for valuation |
| Protocol | Read-only query via stable `idauto.vehicles.id` |
| AutoValeur stores | `vehicle_id` reference + JSON snapshot of facts used at valuation time |
| AutoValeur does NOT modify | Any `idauto_` table |
| Required facts | make, model, variant, year, fuel, category, body_type, confidence_score |
| Optional facts | vin (MYTHOS_PRIVATE scope), plate_number, verified technical attributes |
| Activation | AVA-2 |

### 4.2 Atelier Network (`atelier_network schema`)

| Contract point | Detail |
|---|---|
| Purpose | Inspection results and repair estimates for Level 2 valuation (any accredited provider) |
| Protocol | Read-only reference via stable `inspection_provider_id` and `repair_estimate_id` |
| AutoValeur stores | `inspection_provider_id` (stable), `repair_estimate_id` (stable), repair line items, estimate totals |
| AutoValeur does NOT store | Customer name, CIN, contact, invoice amounts, payment records |
| Display wording | "Estimation après inspection [Workshop Name]" — prohibited: "Expertise légale certifiée" |
| First provider | Fixpert (EXTERNAL_CONNECTED mode — API contract to be specified in ATN-1) |
| Activation | AVA-2 (after ATN-1) |

### 4.3 Spare-Parts Platforms (external)

| Contract point | Detail |
|---|---|
| Purpose | Parts prices, availability, and compatibility for repair estimates |
| Initial source | ssangyong.autos (existing platform in Mythos ecosystem) |
| Future sources | General spare-parts website (future) |
| Protocol | API query or authorised data feed — specific protocol TBD in AVA-2 |
| AutoValeur stores | Parts price snapshot at quote time, source, availability, date |
| Legal status | LEGAL-REVIEW-REQUIRED per source |
| Activation | AVA-2 |

### 4.4 Marketplace (future external)

| Contract point | Detail |
|---|---|
| Purpose | Listing prices, price history, time-to-sale, completed transaction prices |
| Protocol | Authorised API or data feed — not scraping |
| Legal status | LEGAL-REVIEW-REQUIRED — marketplace terms of service review required |
| AutoValeur stores | Listing snapshot (asking price, date, metadata), completed sale price (separate field) |
| AutoValeur does NOT store | Seller identity, buyer identity, private contact details |
| Activation | AVA-5 |

### 4.5 Mythos OS (`mythos_core schema`)

| Contract point | Detail |
|---|---|
| Authentication | Session tokens validated against mythos_core |
| Roles and permissions | `MYTHOS_SUPER_ADMIN`, org-level roles checked against mythos_core |
| Audit | High-level events published to Mythos OS audit stream; authoritative local record in `autovaleur_audit_events` |
| Notifications | Subscription alerts, deal alerts (MYTHOS_PRIVATE) — Mythos notification service |
| Billing | Professional subscription billing — Mythos billing service |
| Activation | AVA-1 (auth), AVA-3 (billing), AVA-4 (deal notifications) |

---

## 5. Data Flow — Public Valuation

```
Caller (public or authenticated)
  │
  ▼
Rate-limit check
  │  fail → 429
  │  pass ↓
Input validation (vehicle details, mileage, condition)
  │
  ▼
ID Auto lookup (if plate provided and authorised)
  │  → vehicle_id + fact snapshot
  │
  ▼
Comparable selection
  │  → filter by make/model/year/fuel/region
  │  → apply stale-listing reduction
  │  → remove duplicates and outliers
  │
  ▼
Weighted comparable analysis
  │  → depreciation adjustment (mileage, age)
  │  → condition discount or premium
  │  → supply/demand adjustment
  │  → regional adjustment
  │
  ▼
Confidence calculation
  │  → based on comparable count, data completeness, source trust
  │
  ▼
Public result assembly
  │  → apply PUBLIC scope filter (remove professional/private fields)
  │
  ▼
INSERT autovaleur_valuations (immutable)
INSERT autovaleur_audit_events
  │
  ▼
Return public result
```

---

## 6. Data Flow — Repair Estimate

```
Professional user (verified organisation)
  │
  ▼
AutoCheck inspection completed (Atelier Network — first provider: Fixpert)
  │  → inspection_provider_id + repair_estimate_id returned
  │
  ▼
AutoValeur reads repair estimate from Atelier Network endpoint
  │
  ▼
Parts lookup (ssangyong.autos, future platforms)
  │  → price, availability, classification, date
  │
  ▼
Labour calculation (workshop rate × hours, via Atelier Network)
  │
  ▼
Contingency reserve applied (configurable %)
  │
  ▼
Total reconditioning estimate
  │
  ▼
INSERT autovaleur_repair_estimates
INSERT autovaleur_repair_estimate_lines
  │
  ▼
Post-inspection valuation recalculated
```

---

## 7. Data Flow — Deal Radar (MYTHOS_PRIVATE)

```
Authorised listing source (API or authorised feed)
  │
  ▼
Normalisation (price, make/model, mileage, region)
  │
  ▼
Duplicate detection (image hash, plate, description)
  │  → duplicate → discard
  │  → new listing ↓
ID Auto vehicle matching
  │  → match → link vehicle_id
  │  → no match → create preliminary fiche in ID Auto queue
  │
  ▼
Market valuation (full comparable analysis)
  │
  ▼
Repair and parts estimate (where Fixpert data available)
  │
  ▼
Liquidity and risk analysis
  │
  ▼
Opportunity score calculation
  │
  ▼
INSERT autovaleur_deal_alerts (MYTHOS_PRIVATE)
  │
  ▼
Mythos notification → human reviewer
  │
  ▼
Human decision → INSERT autovaleur_deal_pipeline (state = shortlisted / rejected)
```

No step in this flow triggers automatic purchase, automatic seller contact, or any bypass of marketplace terms.

---

## 8. Deployment Separation

In AVA-0, there is no deployed AutoValeur service.

**Permanent constraints:**
- Do not touch `/var/www/uthinachess/0726/Prod/` — Mythos OS production
- Do not restart nginx or PHP on the Mythos OS VPS
- Do not deploy AutoValeur files to any server before AVA-1 with explicit authorisation
- Do not ingest real market listing data before legal review is complete
- Do not install PostgreSQL before IDA-2/AVA-1 with explicit authorisation
- Do not scrape any website
- Do not contact any marketplace API without authorisation

---

## 9. Technology Decisions — Status

| Decision | Status |
|---|---|
| Target DBMS | PostgreSQL — selected (shared with ID Auto and Fixpert) |
| API framework | Deferred to AVA-1 |
| Hosting model | Deferred to AVA-1 (likely same VPS as Mythos OS initially) |
| Object storage | Deferred to AVA-1 |
| Valuation model approach | Rule-based (AVA-1); ML deferred until sufficient clean data |
| Marketplace data source | LEGAL-REVIEW-REQUIRED — no source contracted |
| Parts data source | ssangyong.autos (existing); protocol TBD in AVA-2 |
| Deal Radar listing source | LEGAL-REVIEW-REQUIRED — no source contracted |
