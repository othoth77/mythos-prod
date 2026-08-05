# Mythos Automotive — Ecosystem Roadmap

**Stage:** MAE-0 Ecosystem Master Foundation
**Last updated:** 2026-08-05
**Repository:** othoth77/mythos-prod

---

## 1. Operating Principles

### 1.1 One Major Implementation Stage at a Time

Only one major implementation stage is active at a time unless explicitly authorised otherwise. A major implementation stage means: building new runtime code, deploying new services, executing database migrations, or connecting live data sources.

Documentation stages (MAE-0, IDA-1, AVA-0, etc.) may run in parallel across product tracks. Preparation is not implementation.

**Current state (MAE-0 complete):**
- IDA-2 is the next authorised implementation stage
- AVA-1 waits for IDA-2's shared PostgreSQL cluster
- Mythos OS Stage 3D–3G continues as its own track and must not be destabilised

### 1.2 Stage Naming Convention

Each stage is prefixed by product abbreviation and numbered from 0:
- `MAE-N` — Mythos Automotive Ecosystem (umbrella governance)
- `IDA-N` — ID Auto
- `AVA-N` — AutoValeur
- `FXP-N` — Fixpert Atelier
- `PNW-N` — Parts Network
- `AMK-N` — AutoMarket Verified
- `FLT-N` — Fleet Pro
- `AST-N` — Fixpert Assistance

Stage 0 is always a documentation and specification stage. No runtime code, no database migrations, no live data.

### 1.3 Dependency Map

Stages blocked on other stages are listed with their blocker. All dependency relationships are strict: a blocked stage must not begin until its dependency stage is complete and its gate requirements are met.

```
Mythos OS (Stage 3A-3G)
    └── [AUTH, BILLING, ROLES] ──► IDA-2 ──► IDA-3 ──► IDA-4
                                       │
                                       └──► AVA-1 ──► AVA-2
                                                        │
                                       IDA-4 ──────────┘
                                                        └──► AVA-3 ──► AVA-4
                                                                         │
                                              AVA-5 (AutoMarket)  ◄──────┘

AutoMarket: requires IDA-3 (public lookup) + AVA-1 (valuation) + Legal clearance
Fleet Pro:  requires IDA-2 + Fixpert Atelier (IDA-4 scope) + Legal clearance
Assistance: requires Fixpert Atelier (IDA-4 scope) + Legal clearance
```

---

## 2. Ecosystem Governance Stages (MAE-*)

### MAE-0 — Ecosystem Master Foundation

**Status:** IN PROGRESS
**Objective:** Establish the complete master documentation, governance, and draft control-plane schema for the Mythos Automotive umbrella.

**Files created:**
- `projects/automotive/README.md`
- `projects/automotive/config/automotive.example.json`
- `projects/automotive/database/control-plane-schema.sql`
- `docs/AUTOMOTIVE_VISION.md`
- `docs/AUTOMOTIVE_PRODUCT_PORTFOLIO.md`
- `docs/AUTOMOTIVE_ARCHITECTURE.md`
- `docs/AUTOMOTIVE_INTEGRATION_CONTRACTS.md`
- `docs/AUTOMOTIVE_DATA_GOVERNANCE.md`
- `docs/AUTOMOTIVE_OPERATING_MODEL.md`
- `docs/AUTOMOTIVE_KPI_MODEL.md`
- `docs/AUTOMOTIVE_RISK_REGISTER.md`
- `docs/AUTOMOTIVE_ROADMAP.md` (this file)

**Master Architecture Decisions (MADs):** MAD-1 through MAD-8

**No implementation in this stage:**
- No PostgreSQL install or migration
- No deployment
- No live data ingestion
- No runtime code

### MAE-1 — Shared Platform Spec and Foundation Integration

**Status:** NOT STARTED — blocked on IDA-2 complete
**Objective:** Specify and implement the shared platform services that all automotive products consume: unified rate limiting, ecosystem audit envelope, vehicle taxonomy API, inter-product event bus (design only), Mythos Core automotive module.

**Prerequisites:**
- MAE-0 complete
- IDA-2 complete (PostgreSQL cluster live, vehicle taxonomy API endpoint available)

**Scope (specification + limited implementation):**
- Unified rate-limit service (resolves R-T04)
- Ecosystem audit envelope schema (resolves R-T05)
- Vehicle taxonomy API endpoint specification (design finalized in IDA-2)
- Scope column `access_scope` standardised across all schemas (resolves R-T03)
- Vehicle_id canonical identifier protocol (merge/split, propagation rules — resolves R-D01)
- Table naming convention decision (resolves R-T06)
- Fixpert integration specification document (required before IDA-4 — resolves R-B08)
- Legal requirements registry implementation in Mythos Core

**Gate requirements:**
- IDA-2 production-ready (PostgreSQL cluster stable)
- Scope standardisation decision documented and approved

### MAE-2 — Control Plane Alpha

**Status:** NOT STARTED — blocked on MAE-1 and IDA-3 complete
**Objective:** Implement the Mythos Automotive Control Center — the administrative interface for ecosystem governance: product health dashboard, LEGAL-REVIEW-REQUIRED item tracker, KPI registry, integration contract registry, access review tools.

**Prerequisites:**
- MAE-1 complete
- IDA-3 complete (professional API operational)

### MAE-3 — Ecosystem Audit Stream

**Status:** NOT STARTED — blocked on MAE-2 complete
**Objective:** Implement the cross-product audit event pipeline: common event envelope publication, dead-letter review, audit query interface, access pattern anomaly detection.

**Prerequisites:**
- MAE-2 complete

### MAE-4 — Legal Requirements Resolution Programme

**Status:** ONGOING — not blocked on any stage, but requires legal counsel engagement
**Objective:** Systematically resolve the 30+ LEGAL-REVIEW-REQUIRED items that block implementation stages. Parallel workstream, not gated by code stages.

**Current open items by blocking stage:**
- IDA-3 blocking: R-L01 (legal basis for plate lookup)
- IDA-4 blocking: R-L02 (ANPR/Smart Gate approval)
- AVA-1 blocking: R-L03 (AutoValeur disclaimer wording)
- AVA-4 blocking: R-L04 (Deal Radar conflict-of-interest governance), R-D03 (Deal Radar write protocol)
- AutoMarket blocking: R-L05, R-L09
- Fixpert/AutoCheck blocking: R-L06 (inspection report wording)
- All stages: R-L07 (data retention), R-B01 (legal counsel assignment)

---

## 3. ID Auto Stages (IDA-*)

### IDA-0 — Product Foundation (Specification)

**Status:** COMPLETE

Documents created: `IDAUTO_PRODUCT_SPEC.md`, database schema draft.

### IDA-1 — Administrative Core and Backoffice

**Status:** COMPLETE — remote HEAD: bd6ec7e (prior to AVA-0)

Implementation included: admin panel, first migration scripts, Mythos Core integration, confidence scoring, review queue, capture session tools.

### IDA-2 — PostgreSQL Cluster and Professional API

**Status:** NOT STARTED — NEXT AUTHORISED IMPLEMENTATION STAGE
**Objective:** Provision the shared PostgreSQL cluster, execute first production migrations for ID Auto, launch the professional vehicle lookup API.

**Prerequisites:**
- Mythos OS Stage 3D–3F complete
- PostgreSQL hosting environment provisioned
- Secrets management configured
- Staging environment separate from production

**Scope:**
- Shared PostgreSQL cluster provisioned (one cluster serves all automotive schemas)
- ID Auto schema migrations executed (not run in MAE-0 or AVA-0)
- Vehicle lookup API: public tier (plate → basic vehicle facts) and professional tier
- Vehicle taxonomy API endpoint (returns make/model/variant/fuel/body/category)
- `access_scope` column standardised (rename `visibility_scope` in ID Auto tables)
- Merge/split vehicle_id protocol (resolves R-D01 and R-D05)
- First integration: AutoValeur can read vehicle facts via API

**Do not begin concurrently with:**
- Mythos OS Stage 3G (HIGH risk — 30 routes, 19 storage keys; must have its own deployment window)
- AVA-1

**Risk watch:** R-T01 (shared VPS — staging must not touch production), R-T02 (Stage 3G timing)

### IDA-3 — Public Vehicle Lookup and Plate Verification

**Status:** NOT STARTED — blocked on IDA-2 complete and R-L01 resolved
**Objective:** Launch the public plate lookup API with rate limiting; verify plate format rules against official source.

**Prerequisites:**
- IDA-2 complete
- Legal basis confirmed (R-L01 resolved — BLOCKING)
- Plate format rules verified against official Tunisian registry (R-D02)

**Scope:**
- Public rate-limited vehicle lookup (anonymous callers)
- Plate format verification and correction
- Carte grise document scan OCR (memory only — no PII stored)
- Contributor submission flow (public)
- PII routing: OCR owner extract → consent → fixpert.clients or discard (never to idauto_)

### IDA-4 — Fixpert Smart Gate Integration

**Status:** NOT STARTED — blocked on IDA-3 complete and R-L02 resolved
**Objective:** Connect Smart Gate camera captures to ID Auto observations. Establish the Fixpert–ID Auto integration.

**Prerequisites:**
- IDA-3 complete
- Fixpert integration specification (MAE-1 scope — R-B08)
- Smart Gate ANPR regulatory approval (R-L02 — BLOCKING)
- Fixpert API contract available

**Scope:**
- Smart Gate camera observation ingestion API
- Fixpert–ID Auto vehicle_id linkage for work orders
- Observation privacy enforcement (MYTHOS_PRIVATE for raw captures, timestamps, location)
- Smart Gate boundary enforcement: Fixpert owns device and consent; ID Auto owns observation

---

## 4. AutoValeur Stages (AVA-*)

### AVA-0 — Product Foundation (Specification)

**Status:** COMPLETE — commit 58e0b07

Documents: `AUTOVALEUR_ARCHITECTURE.md`, `AUTOVALEUR_ROADMAP.md`, database schema (18 tables), config (`autovaleur.example.json`).

Architecture decisions confirmed: AD-A1 through AD-A8. Deal Radar write rule confirmed: AutoValeur submits to ID Auto ingestion API, does not write to idauto_ tables.

### AVA-1 — Valuation Engine v1 and Market Data Ingestion

**Status:** NOT STARTED — blocked on IDA-2 complete
**Objective:** Implement the core valuation engine: comparable selection, confidence scoring, market range output, liquidity score, first authorised data source integration.

**Prerequisites:**
- IDA-2 complete (vehicle API and shared PostgreSQL cluster available)
- AutoValeur schema migrations executed (first migration — control-plane-schema.sql is a draft, not the migration script)
- First authorised data source contract signed (LEGAL-REVIEW-REQUIRED)
- AutoValeur disclaimer wording approved (R-L03 — BLOCKING for public output)

**Scope:**
- First AutoValeur schema migration (autovaleur PostgreSQL schema)
- ID Auto vehicle lookup integration (reads from IDA-2 API)
- First market listing source integration (source TBD, LEGAL-REVIEW-REQUIRED)
- Valuation engine v1: comparable engine, range calculation, confidence score
- Liquidity score
- Public and professional valuation outputs
- Immutable valuation records

**Do not begin concurrently with IDA-2.**

### AVA-2 — Fixpert Integration and Repair-Adjusted Valuation

**Status:** NOT STARTED — blocked on IDA-4 complete
**Objective:** Integrate Fixpert inspection data and Parts Network prices into the repair-adjusted valuation output.

**Prerequisites:**
- IDA-4 complete (BLOCKING — Fixpert integration requires Smart Gate spec complete)
- Parts Network price API available (or authorised feed)
- ssangyong.autos integration contract signed (LEGAL-REVIEW-REQUIRED — R-D06)

**Scope:**
- Fixpert repair estimate ingestion (reads `fixpert_inspection_ref`, repair line items)
- Parts Network price snapshot at quote time
- Repair-adjusted condition report and valuation
- Source trust scoring for repair data

### AVA-3 — Model Governance and Manipulation Resistance

**Status:** NOT STARTED — blocked on AVA-2 complete
**Objective:** Implement model versioning, evaluation pipeline, manipulation resistance features.

**Prerequisites:**
- AVA-2 complete
- ≥ 50 matched valuation-to-sale pairs available (model accuracy KPI prerequisite)

**Scope:**
- Model version registry
- Model evaluation record (accuracy metrics: MAE, MAPE, hit rate)
- Outlier removal and source trust scoring improvements
- Stale-listing decay
- Duplicate listing detection
- Asking price vs completed sale price separation enforcement

### AVA-4 — Deal Radar (MYTHOS_PRIVATE)

**Status:** NOT STARTED — blocked on AVA-3 complete and legal governance resolved
**Objective:** Implement the MYTHOS_PRIVATE opportunity scoring, deal alert generation, and deal pipeline.

**Prerequisites:**
- AVA-3 complete
- Deal Radar conflict-of-interest governance documented and approved (R-L04 — BLOCKING)
- Deal Radar implementation follows ingestion-request protocol (R-D03)

**Scope:**
- Opportunity scoring (MYTHOS_PRIVATE)
- Deal alert generation and pipeline
- Deal Radar → ID Auto ingestion request API (not direct write)
- Full MYTHOS_PRIVATE audit log on all Deal Radar access
- Human review required for all deal pipeline actions

### AVA-5 — Completed Sale Price Integration

**Status:** NOT STARTED — blocked on AVA-4 complete and AutoMarket operational
**Objective:** Integrate completed sale prices from AutoMarket into the valuation model's feedback loop.

**Prerequisites:**
- AVA-4 complete
- AutoMarket operational with completed transaction records
- Legal authorisation for completed price publication (R-L09 — BLOCKING)

### AVA-6 — External Valuation API and Partner Integrations

**Status:** NOT STARTED — blocked on AVA-5 complete
**Objective:** Open a professional API for external partners (insurers, fleet operators, banks) to request valuations with guaranteed SLA.

**Prerequisites:**
- AVA-5 complete
- Legal framework for API licensing (LEGAL-REVIEW-REQUIRED)
- Model accuracy KPIs meeting target thresholds

---

## 5. Fixpert Atelier Stages (FXP-*)

Fixpert Atelier is an external production system. Its stages are governed by the Fixpert operating model.

The Fixpert stages relevant to this repository are:
- FXP-1 (IDA-4 dependency): Smart Gate API contract and integration specification — required before IDA-4
- FXP-2 (AVA-2 dependency): Fixpert repair estimate API — required before AVA-2
- FXP-3 (AutoCheck): AutoCheck by Fixpert product specification and launch

**AutoCheck by Fixpert** is a CONCEPT stage. It requires:
- Fixpert integration specification (MAE-1 scope)
- Inspection liability wording legal review (R-L06 — BLOCKING)
- Display wording: "AutoCheck by Fixpert" / "Inspecté par Fixpert" — never "Expertise légale certifiée"

---

## 6. Parts Network Stages (PNW-*)

Parts Network for ssangyong.autos is a production external system. General Parts Network is a CONCEPT.

- PNW-0: Parts Network specification (CONCEPT stage — not started)
- PNW-1: First authorised parts catalogue integration (requires legal review per source — LEGAL-REVIEW-REQUIRED)
- PNW-2: Used spare-parts marketplace (LEGAL-REVIEW-REQUIRED for product liability)

---

## 7. AutoMarket Verified Stages (AMK-*)

AutoMarket Verified is a CONCEPT stage.

**Prerequisites for AMK-0 (specification):**
- IDA-3 complete (vehicle lookup for listing verification)
- AVA-1 complete (valuation reference for listing)
- AutoMarket legal framework (R-L05, R-L09)

**Known requirements (CONCEPT):**
- 9 listing statuses (DRAFT → PUBLISHED → UNDER_OFFER → RESERVED → SOLD → CANCELLED → EXPIRED → WITHDRAWN → ARCHIVED)
- 6 verification badges with defined meanings (VEHICLE_VERIFIED, INSPECTION_VERIFIED, PRICE_BENCHMARKED, SELLER_VERIFIED, IDENTITY_CHECKED, TRANSACTION_MONITORED)
- ID Auto vehicle_id required for any listing
- AutoValeur valuation reference for PRICE_BENCHMARKED badge
- Marketplace fraud controls (R-B06)
- Completed sale price reporting for AutoValeur AVA-5 feedback loop

---

## 8. Fleet Pro and Fixpert Assistance Stages (FLT-*, AST-*)

Both are CONCEPT stages. No specification started.

**Fleet Pro prerequisites:**
- IDA-2 complete (vehicle_id API)
- Fixpert Atelier integration contract (IDA-4 scope)
- Fleet legal framework (LEGAL-REVIEW-REQUIRED)

**Fixpert Assistance prerequisites:**
- Fixpert Atelier integration contract (IDA-4 scope)
- Assistance legal framework (LEGAL-REVIEW-REQUIRED)

---

## 9. Stage Summary Table

| Stage | Product | Status | Blocked on |
|-------|---------|--------|------------|
| MAE-0 | Ecosystem | IN PROGRESS | — |
| IDA-1 | ID Auto | COMPLETE | — |
| AVA-0 | AutoValeur | COMPLETE | — |
| **IDA-2** | **ID Auto** | **NEXT** | **Mythos OS 3D-3F** |
| AVA-1 | AutoValeur | NOT STARTED | IDA-2 |
| MAE-1 | Ecosystem | NOT STARTED | IDA-2 |
| IDA-3 | ID Auto | NOT STARTED | IDA-2, R-L01 |
| AVA-2 | AutoValeur | NOT STARTED | IDA-4 |
| MAE-2 | Ecosystem | NOT STARTED | MAE-1, IDA-3 |
| IDA-4 | ID Auto | NOT STARTED | IDA-3, R-L02, MAE-1 |
| AVA-3 | AutoValeur | NOT STARTED | AVA-2 |
| MAE-3 | Ecosystem | NOT STARTED | MAE-2 |
| AVA-4 | AutoValeur | NOT STARTED | AVA-3, R-L04 |
| AMK-0 | AutoMarket | NOT STARTED | IDA-3, AVA-1, Legal |
| AVA-5 | AutoValeur | NOT STARTED | AVA-4, AutoMarket |
| AVA-6 | AutoValeur | NOT STARTED | AVA-5, Legal |
| FXP-1 | Fixpert | External | MAE-1 (spec) |
| PNW-0 | Parts | CONCEPT | — |
| FLT-0 | Fleet | CONCEPT | IDA-2, IDA-4 |
| AST-0 | Assistance | CONCEPT | IDA-4 |
| MAE-4 | Ecosystem (Legal) | ONGOING | Legal counsel |

---

## 10. Critical Path to Alpha

Minimum viable Mythos Automotive Alpha = ID Auto professional API + AutoValeur public valuation.

```
[NOW] MAE-0 docs ──► IDA-2 (PostgreSQL + vehicle API)
                         │
                         ├──► AVA-1 (valuation engine v1)
                         │         └── ALPHA REACHED ──►
                         │
                         └──► MAE-1 (shared platform)
```

**Legal blockers that must resolve before Alpha:**
- R-L01: Legal basis for professional plate lookup → IDA-2 professional API gate
- R-L03: AutoValeur disclaimer wording → AVA-1 public output gate
- R-L07: Retention periods for valuation records → any production deployment

**Technical blockers:**
- R-D01: Canonical vehicle_id protocol → before IDA-2 goes live
- R-T03: `access_scope` standardisation → before IDA-2 schema migration
- R-T01: Environment separation (staging ≠ production) → before IDA-2 deployment
