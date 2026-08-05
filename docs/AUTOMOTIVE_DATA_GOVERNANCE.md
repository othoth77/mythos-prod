# Mythos Automotive — Data Governance

**Stage:** MAE-0 Ecosystem Master Foundation
**Last updated:** 2026-08-05
**Repository:** othoth77/mythos-prod

---

## 1. Master Data Ownership Matrix

The source-of-truth rule: each data entity has exactly one owner. All other products hold references.

### 1.1 Mythos Core

| Data entity | Owner |
|-------------|-------|
| Platform users (Mythos accounts) | Mythos Core |
| Organisations (subscribed entities) | Mythos Core |
| Global roles and permissions | Mythos Core |
| Service accounts and API clients | Mythos Core |
| Product entitlements | Mythos Core |
| Integration registry | Mythos Core |
| Feature flags | Mythos Core |
| Environment registry | Mythos Core |
| Release registry | Mythos Core |
| Global audit event stream | Mythos Core |
| Retention policy definitions | Mythos Core |
| Legal requirement registry | Mythos Core |
| Domain and endpoint catalogue | Mythos Core |
| Backup status registry | Mythos Core |

Mythos Core must not become the owner of Fixpert invoices, marketplace transactions, spare-parts orders, AutoValeur estimates, or vehicle observations. It coordinates; it does not duplicate operational domains.

### 1.2 ID Auto

| Data entity | Owner |
|-------------|-------|
| Canonical vehicle_id | ID Auto |
| Plate identities | ID Auto |
| Authorised VIN facts | ID Auto |
| Vehicle observations (immutable) | ID Auto |
| Verified vehicle facts (versioned) | ID Auto |
| Vehicle fact evidence | ID Auto |
| Vehicle taxonomy (make/model/variant/fuel/body_type/category) | ID Auto |
| Governorate reference data | ID Auto |
| Plate format rules | ID Auto |
| Capture sessions and capture sources | ID Auto |
| Camera sources (Smart Gate) | ID Auto |
| Vehicle movements (MYTHOS_PRIVATE) | ID Auto |
| Observation locations (MYTHOS_PRIVATE) | ID Auto |
| Document scans (carte grise — no PII stored) | ID Auto |
| Contributor trust scores | ID Auto |
| Review queue | ID Auto |
| ID Auto audit log | ID Auto |

### 1.3 Fixpert

| Data entity | Owner |
|-------------|-------|
| Customers (automotive clients) | Fixpert |
| Customer PII (name, CIN, address, contact) | Fixpert |
| Customer consent records | Fixpert |
| Appointments | Fixpert |
| Vehicle check-in records | Fixpert |
| Inspections and diagnostics | Fixpert |
| Work orders | Fixpert |
| Interventions and labour records | Fixpert |
| Workshop quotations | Fixpert |
| Workshop invoices | Fixpert |
| Payments | Fixpert |
| Workshop employees and operational records | Fixpert |
| Smart Gate camera device and consent obligation | Fixpert |

Note: The `fixpert` PostgreSQL schema is documented by reference in this repository. It is not created by this repository's migration scripts. Fixpert owns and manages its own schema.

### 1.4 Parts Network

| Data entity | Owner |
|-------------|-------|
| Canonical part_id | Parts Network |
| OEM and alternative part references | Parts Network |
| Vehicle fitment/compatibility catalogue | Parts Network |
| Brands and categories | Parts Network |
| Suppliers | Parts Network |
| Warehouses and stock locations | Parts Network |
| Condition (new / used / refurbished) | Parts Network |
| Purchase prices | Parts Network |
| Selling prices | Parts Network |
| Availability and delivery estimates | Parts Network |
| Parts images and technical documents | Parts Network |
| Storefront channel configuration | Parts Network |
| Parts orders | Parts Network |
| Fulfilment records | Parts Network |

### 1.5 AutoValeur

| Data entity | Owner |
|-------------|-------|
| Valuation records (immutable snapshots) | AutoValeur |
| Valuation inputs | AutoValeur |
| Comparable analyses | AutoValeur |
| Market listing snapshots (authorised sources) | AutoValeur |
| Listing price snapshots | AutoValeur |
| Condition reports | AutoValeur |
| Repair estimate records | AutoValeur |
| Parts quote snapshots at quote time | AutoValeur |
| Liquidity scores | AutoValeur |
| Opportunity scores (MYTHOS_PRIVATE) | AutoValeur |
| Deal alerts (MYTHOS_PRIVATE) | AutoValeur |
| Deal pipeline (MYTHOS_PRIVATE) | AutoValeur |
| Transaction records (MYTHOS_PRIVATE) | AutoValeur |
| Valuation model versions | AutoValeur |
| Model evaluation records | AutoValeur |
| Source catalogue | AutoValeur |
| AutoValeur audit events | AutoValeur |

### 1.6 AutoMarket (future)

| Data entity | Owner |
|-------------|-------|
| Marketplace listings (live, seller-managed) | AutoMarket |
| Listing leads and enquiries | AutoMarket |
| Offers | AutoMarket |
| Accepted offers | AutoMarket |
| Completed transaction records | AutoMarket |
| Listing performance data | AutoMarket |

### 1.7 Fleet (future)

| Data entity | Owner |
|-------------|-------|
| Fleet membership | Fleet |
| Fleet policy | Fleet |
| Operational assignments | Fleet |
| Cost and maintenance dashboards | Fleet |

### 1.8 Assistance (future)

| Data entity | Owner |
|-------------|-------|
| Assistance cases | Assistance |
| Dispatch records | Assistance |
| Towing and service records | Assistance |
| Assistance contracts | Assistance |

---

## 2. Canonical Identifier Specification

### 2.1 Rules

- IDs are stable and opaque: no business meaning is encoded in any identifier
- IDs are never reused after the record is deleted
- External IDs are stored separately with source and date — never overwrite the canonical ID
- Cross-product records reference IDs, not copied business data
- PII must not be embedded in or derivable from any ID
- Merged records retain the canonical ID of the survivor and an alias table for the absorbed record
- A merge event is immutable: the merge history is always preserved

### 2.2 Canonical ID Registry

| ID | Owner product | Schema | Type | Notes |
|----|--------------|--------|------|-------|
| `vehicle_id` | ID Auto | idauto | BIGSERIAL | Central to entire ecosystem |
| `plate_id` | ID Auto | idauto | BIGSERIAL | |
| `observation_id` | ID Auto | idauto | BIGSERIAL | Immutable |
| `fact_id` | ID Auto | idauto | BIGSERIAL | Versioned |
| `document_scan_id` | ID Auto | idauto | BIGSERIAL | |
| `mythos_user_id` | Mythos Core | mythos_core | BIGSERIAL | Platform identity |
| `organization_id` | Mythos Core | mythos_core | BIGSERIAL | |
| `customer_ref` | Fixpert | fixpert | Fixpert-defined | Not in this repository |
| `inspection_id` | Fixpert | fixpert | Fixpert-defined | |
| `work_order_id` | Fixpert | fixpert | Fixpert-defined | |
| `part_id` | Parts Network | parts | Parts-defined | |
| `supplier_id` | Parts Network | parts | Parts-defined | |
| `valuation_id` | AutoValeur | autovaleur | BIGSERIAL | |
| `listing_id` | AutoMarket | automarket | Future | |
| `offer_id` | AutoMarket | automarket | Future | |
| `transaction_id` | AutoMarket | automarket | Future | |
| `fleet_id` | Fleet | fleet | Future | |
| `assistance_case_id` | Assistance | assistance | Future | |
| `document_id` | Mythos Core | mythos_core | BIGSERIAL | Object storage reference |
| `media_id` | Mythos Core | mythos_core | BIGSERIAL | Object storage reference |
| `integration_id` | Mythos Core | mythos_core | BIGSERIAL | Integration registry |
| `event_id` | Per product | Per product | UUID | Cross-product correlation |
| `audit_event_id` | Per product | Per product | BIGSERIAL | |

### 2.3 ID Format Standard

- Opaque sequential integers (BIGSERIAL) for internal database records
- UUID v4 for cross-product correlation IDs and idempotency keys
- No composite IDs encoding date, product, or region
- No human-readable IDs that encode PII

---

## 3. Customer and PII Boundaries

### 3.1 No Global Customer Database

Mythos Automotive does not maintain a unified global customer database. Customer PII belongs to the product that received it with consent from the subject.

| Customer type | PII owner | Scope |
|--------------|-----------|-------|
| Fixpert workshop client | Fixpert | `fixpert.clients` — never in `idauto_` or `autovaleur_` |
| Marketplace seller | AutoMarket | AutoMarket listing table — never in ID Auto |
| Marketplace buyer | AutoMarket | Only if explicitly consented |
| Professional subscriber | Mythos Core | Organisation profile — not duplicated per product |
| Platform user | Mythos Core | Authentication record |

### 3.2 Cross-Product PII Sharing

Cross-product PII sharing is permitted only:
- With the subject's explicit consent
- For a documented specific purpose
- Via consent-scoped access (`consent_shared` scope)
- With a documented legal basis
- With a recorded consent event
- With a defined retention period for the shared copy

Example: Carte grise owner PII extracted during OCR → shown to submitter for confirmation → if consented, routed to `fixpert.clients` → never stored in any `idauto_` column.

### 3.3 opaque Customer References

When AutoValeur references a Fixpert customer in a repair estimate, it stores only `fixpert_inspection_ref` (a stable ID). Customer name, CIN, contact, or financial detail are never copied into `autovaleur_` tables.

### 3.4 Subject Rights Workflows

**LEGAL-REVIEW-REQUIRED** — specific workflows require legal review before implementation.

| Right | Workflow |
|-------|---------|
| Access request | Caller requests all data held; each owning product responds independently |
| Correction | Subject requests correction; propagated to owner product only |
| Consent withdrawal | Consent record updated; sharing immediately revoked; consented copies deleted |
| Deletion request | Owner product deletes or anonymises; other products delete references or snapshots |
| Retention hold | Legal hold flag prevents deletion until explicitly lifted |
| Legal restriction | Access restricted on court order or regulatory requirement |
| Cross-product propagation | Subject right request routed to all products holding the subject's data |

---

## 4. Vehicle Data Privacy Rules

These rules complement the privacy constraints in IDAUTO_PRODUCT_SPEC.md.

| Constraint | Description |
|------------|-------------|
| No public owner identity | Vehicle plate or fiche does not expose owner name, CIN, address or contact |
| No public movement history | Vehicle check-in/check-out, observation timestamps, or routes are MYTHOS_PRIVATE |
| No public camera data | Smart Gate captures, frame images, and raw OCR are MYTHOS_PRIVATE |
| No vehicle tracking product | Aggregated vehicle movement must not become a public tracking or owner-profiling service |
| Confidence minimum for public display | Vehicle facts are shown publicly only above the confidence threshold (0.70 per IDA-1 spec) |

---

## 5. Access Scope Definitions

### 5.1 Standard Scopes

| Scope | Who accesses | Audit required | Example data |
|-------|-------------|---------------|-------------|
| `public` | Any caller within rate limits | No | Plate number, colour, make/model (verified), year, governorate |
| `professional` | Verified subscriber organisations | No | Technical facts, service event count, repair estimate |
| `mythos_private` | Mythos Super Admin only | **Yes — every access** | Raw captures, exact GPS, exact timestamps, VIN, camera source, deal pipeline |
| `product_internal` | Owning product API only | No | Internal processing state, queue items |
| `organization_private` | One organisation | No | Fixpert invoice, customer fiche |
| `consent_shared` | Specific product, subject-consented | No | Customer PII shared between Fixpert and future product |

### 5.2 Visibility vs Ownership

These are different concepts. A Fixpert invoice is `organization_private` — owned by Fixpert, visible within Fixpert's organisation. A Mythos Super Admin may access it with `mythos_private` override, but this does not change ownership.

A vehicle colour is `public` — ID Auto is the owner; any caller may read it.

A raw Smart Gate camera frame is `mythos_private` — ID Auto owns it; only the Mythos Super Admin may access it, with audit logging.

---

## 6. Retention and Deletion Policy

**LEGAL-REVIEW-REQUIRED** — all specific retention periods must be set through legal review.

| Data category | Retention class | Notes |
|---------------|----------------|-------|
| Vehicle observations | Permanent | Immutable evidence; never deleted once accepted |
| Verified vehicle facts | Permanent (versioned) | Old versions retained; never destroyed |
| Audit events | Long-term | Minimum regulatory period — LEGAL-REVIEW-REQUIRED |
| Valuation records | Long-term | Required for model accuracy feedback loop |
| Market listing snapshots | Medium-term | Source data for model training |
| Condition reports | Medium-term | Linked to valuation; follows valuation retention |
| Customer PII (Fixpert) | Subject to consent and legal basis | LEGAL-REVIEW-REQUIRED |
| Deal pipeline records | MYTHOS_PRIVATE | LEGAL-REVIEW-REQUIRED |
| Document scans (carte grise image) | Short-term | LEGAL-REVIEW-REQUIRED |
| OCR output | Short-term | Not permanently stored per IDA-1 spec |
| Raw camera frames | Short-term | MYTHOS_PRIVATE; LEGAL-REVIEW-REQUIRED |
| Session tokens | Session lifetime | |
| Rate-limit records | Short-term | IP hashes only; not raw IPs |

---

## 7. Data Quality Rules

| Product | Quality responsibility |
|---------|----------------------|
| ID Auto | Observation review, duplicate detection, confidence scoring, fact verification, plate format validation |
| Fixpert | Customer data accuracy, inspection quality, work order completeness |
| Parts Network | Fitment accuracy, catalogue completeness, price timeliness |
| AutoValeur | Comparable quality, outlier removal, stale-listing decay, model accuracy monitoring |
| AutoMarket | Listing accuracy, identity verification, completed sale price accuracy |

**Cross-product quality rule:** A product is responsible for the quality of data it emits to other products. Poor-quality data emitted as an event or API response degrades the consuming product's outputs.

---

## 8. Vehicle Taxonomy Authority

**ID Auto is the authoritative source for the vehicle taxonomy used across the ecosystem.**

The taxonomy includes: make, model, variant, fuel_type, body_type, category.

- AutoValeur uses this taxonomy for comparable selection
- Parts Network uses this taxonomy for fitment/compatibility queries
- AutoMarket uses this taxonomy for listing classification and filtering
- Fleet uses this taxonomy for fleet management categorisation

**Rule:** No other product maintains a competing vehicle taxonomy. If a product needs taxonomy data it does not have, it queries ID Auto's vehicle taxonomy API. It does not create a private local copy.

**Current status:** The vehicle taxonomy lives in ID Auto's tables (`idauto_plate_formats`, `idauto_governorates`, and embedded in `idauto_vehicles`). A dedicated taxonomy API endpoint is part of the IDA-2 scope.
