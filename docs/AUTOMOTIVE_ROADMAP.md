# Mythos Automotive — Ecosystem Roadmap

**Stage:** ATN-0 Atelier Network Foundation and Ecosystem Consistency Amendment
**Last updated:** 2026-08-05
**Repository:** othoth77/mythos-prod

---

## 1. Operating Principles

### 1.1 One Major Implementation Stage at a Time

Only one major implementation stage is active at a time unless explicitly authorised otherwise. A major implementation stage means: building new runtime code, deploying new services, executing database migrations, or connecting live data sources.

Documentation stages (MAE-0, ATN-0, IDA-1, AVA-0, etc.) may run in parallel across product tracks. Preparation is not implementation.

**Current state (ATN-0 complete):**
- IDA-2 is IN PROGRESS — Phase A (schema + plate validation, no live database) complete 2026-08-10; Phase B (PostgreSQL cluster, API) not started, requires separate authorization
- AVA-1 waits for IDA-2 Phase B's shared PostgreSQL cluster
- ATN-1 runs in parallel with IDA-3 and AVA-1 (all documentation — not concurrent with IDA-2 Phase B implementation)
- Mythos OS Stage 3D–3G continues as its own track and must not be destabilised

### 1.2 Stage Naming Convention

Each stage is prefixed by product abbreviation and numbered from 0:
- `MAE-N` — Mythos Automotive Ecosystem (umbrella governance)
- `ATN-N` — Atelier Network (multi-workshop platform)
- `IDA-N` — ID Auto
- `AVA-N` — AutoValeur
- `PNW-N` — Parts Network
- `AMK-N` — AutoMarket Verified
- `FLT-N` — Fleet Pro
- `AST-N` — Assistance

Stage 0 is always a documentation and specification stage. No runtime code, no database migrations, no live data.

### 1.3 Dependency Map

Stages blocked on other stages are listed with their blocker. All dependency relationships are strict: a blocked stage must not begin until its dependency stage is complete and its gate requirements are met.

```
Mythos OS (Stage 3A-3G)
    └── [AUTH, BILLING, ROLES] ──► IDA-2 ──► IDA-3 ──► IDA-4 (+ ATN-1 + legal)
                                       │                     │
                                       │                     └──► AVA-2 (+ AVA-1)
                                       │
                                       └──► AVA-1 ──► AVA-3 ──► AVA-4 ──► AVA-5
                                       │
                                       └──► ATN-1 ──► ATN-2 ──► ATN-3 ──► ATN-4 (+ IDA-4 + legal)
                                                │
                                                └──► AVA-2 (inspection API)
                                       │
                                       └──► MAE-1 ──► MAE-2 ──► MAE-3

AutoMarket: requires IDA-3 (public lookup) + AVA-1 (valuation) + Legal clearance
Fleet Pro:  requires IDA-2 + ATN-1 (Atelier Network integration) + Legal clearance
Assistance: requires ATN-1 (Atelier Network) + Legal clearance
```

---

## 2. Ecosystem Governance Stages (MAE-*)

### MAE-0 — Ecosystem Master Foundation

**Status:** COMPLETE (2026-08-05)
**Objective:** Establish the complete master documentation, governance, and draft control-plane schema for the Mythos Automotive umbrella.

**Files created:**
- `projects/automotive/README.md`
- `projects/automotive/config/automotive.example.json`
- `projects/automotive/database/control-plane-schema.sql` (18 tables)
- `docs/AUTOMOTIVE_VISION.md`
- `docs/AUTOMOTIVE_PRODUCT_PORTFOLIO.md`
- `docs/AUTOMOTIVE_ARCHITECTURE.md`
- `docs/AUTOMOTIVE_INTEGRATION_CONTRACTS.md`
- `docs/AUTOMOTIVE_DATA_GOVERNANCE.md`
- `docs/AUTOMOTIVE_OPERATING_MODEL.md`
- `docs/AUTOMOTIVE_KPI_MODEL.md`
- `docs/AUTOMOTIVE_RISK_REGISTER.md`
- `docs/AUTOMOTIVE_ROADMAP.md` (this file, amended in ATN-0)

**Master Architecture Decisions (MADs):** MAD-1 through MAD-8

**No implementation in this stage:**
- No PostgreSQL install or migration
- No deployment
- No live data ingestion
- No runtime code

### ATN-0 — Atelier Network Foundation and Ecosystem Consistency Amendment

**Status:** COMPLETE (2026-08-05)
**Objective:** Establish Mythos Atelier Network as the generic multi-workshop platform (Fixpert is the first pilot, not the entire workshop domain). Correct roadmap errors. Generalise AutoCheck. Generalise Smart Gate.

**Files created:**
- `projects/atelier-network/README.md`
- `projects/atelier-network/config/atelier-network.example.json`
- `projects/atelier-network/database/schema.sql` (24 tables)
- `docs/ATELIER_NETWORK_PRODUCT_SPEC.md`
- `docs/ATELIER_NETWORK_ARCHITECTURE.md`
- `docs/ATELIER_NETWORK_ROADMAP.md`
- `docs/AUTOCHECK_STANDARD.md`

**Files amended:** AUTOMOTIVE_ROADMAP.md, AUTOMOTIVE_PRODUCT_PORTFOLIO.md, AUTOMOTIVE_ARCHITECTURE.md, AUTOMOTIVE_INTEGRATION_CONTRACTS.md, AUTOMOTIVE_DATA_GOVERNANCE.md, AUTOMOTIVE_OPERATING_MODEL.md, AUTOMOTIVE_KPI_MODEL.md, AUTOMOTIVE_RISK_REGISTER.md, projects/automotive/README.md, projects/automotive/config/automotive.example.json, projects/automotive/database/control-plane-schema.sql (+13 tables = 31 total), IDAUTO_PRODUCT_SPEC.md, IDAUTO_ARCHITECTURE.md, IDAUTO_FIXPERT_INTEGRATION.md, IDAUTO_ROADMAP.md, AUTOVALEUR_ROADMAP.md, AUTOVALEUR_ARCHITECTURE.md, projects/autovaleur/database/schema.sql, docs/ROADMAP.md

**No implementation in this stage.**

### MAE-1 — Shared Platform Spec and Foundation Integration

**Status:** NOT STARTED — blocked on IDA-2 complete
**Objective:** Specify and implement the shared platform services that all automotive products consume: unified rate limiting, ecosystem audit envelope, vehicle taxonomy API, inter-product event bus (design only), Mythos Core automotive module.

**Prerequisites:**
- MAE-0 complete ✓
- ATN-0 complete ✓
- IDA-2 complete (PostgreSQL cluster live, vehicle taxonomy API endpoint available)

**Scope (specification + limited implementation):**
- Unified rate-limit service (resolves R-T04)
- Ecosystem audit envelope schema (resolves R-T05)
- Vehicle taxonomy API endpoint specification (design finalized in IDA-2)
- Scope column `access_scope` standardised across all schemas (resolves R-T03)
- Vehicle_id canonical identifier protocol (merge/split, propagation rules — resolves R-D01)
- Table naming convention decision (resolves R-T06)
- Workshop integration specification document (required before ATN-1 — resolves R-B08)
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
**Objective:** Systematically resolve the 30+ LEGAL-REVIEW-REQUIRED items that block implementation stages.

**Current open items by blocking stage:**
- IDA-3 blocking: R-L01 (legal basis for plate lookup)
- IDA-4 blocking: R-L02 (ANPR/Smart Gate approval — Fixpert)
- ATN-1 blocking: R-ATN-01 (AutoCheck liability wording), R-ATN-02 (workshop onboarding agreement)
- AVA-1 blocking: R-L03 (AutoValeur disclaimer wording)
- AVA-4 blocking: R-L04, R-D03
- AutoMarket blocking: R-L05, R-L09
- All stages: R-L07 (data retention), R-B01 (legal counsel assignment)

---

## 3. Atelier Network Stages (ATN-*)

### ATN-0 — Foundation ✓ Complete

See section 2 above.

### ATN-1 — Core API, Workshop Registry and First Integration

**Status:** NOT STARTED — blocked on IDA-2 complete; parallel with IDA-3 and AVA-1

**Objective:** Deploy the Atelier Network schema, workshop registry API, and repair estimate endpoint (consumed by AVA-2). Specify Fixpert as first EXTERNAL_CONNECTED workshop.

**Prerequisites:**
- IDA-2 complete (shared PostgreSQL cluster)
- Legal: AutoCheck liability wording resolved (R-L06 / R-ATN-01)
- Legal: Workshop onboarding agreement template ready

**Scope:**
- `atelier_network` schema deployed (core tables)
- Workshop registry API
- Inspection provider accreditation registry
- Repair estimate API endpoint (enables AVA-2)
- Fixpert connector specification as first EXTERNAL_CONNECTED pilot
- Mythos Core auth integration
- 50+ automated tests

### ATN-2 — Inspection API and AutoCheck Launch

**Status:** NOT STARTED — blocked on ATN-1 complete

**Objective:** Launch AutoCheck inspection workflow and first report. Activate repair estimate integration with AutoValeur.

**Prerequisites:**
- ATN-1 complete
- R-L06 resolved (inspection report liability)

### ATN-3 — External Connected Mode and Partner Network

**Status:** NOT STARTED — blocked on ATN-2 complete

### ATN-4 — Smart Gate Network and AutoCheck Scale

**Status:** NOT STARTED — blocked on ATN-3 complete; IDA-4 complete; ANPR legal approval per workshop

### ATN-5 — Network Intelligence and Fleet Services

**Status:** FUTURE — blocked on ATN-4 complete; Fleet Pro specification

---

## 4. ID Auto Stages (IDA-*)

### IDA-0 — Product Foundation

**Status:** COMPLETE

Documents created: `IDAUTO_PRODUCT_SPEC.md`, database schema draft.

### IDA-1 — Product Vision, Capture, Access and Data Governance Specification

**Status:** COMPLETE — commit: e9afc7e (prior to AVA-0)

**Scope:** Documentation and specification only. Product vision, three access scopes (PUBLIC / PROFESSIONAL / MYTHOS_PRIVATE), observation-first data model, Smart Gate specification, Fixpert Atelier integration boundaries (Fixpert as first professional pilot), data governance. No implementation. No runtime code.

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
- ID Auto schema migrations executed
- Vehicle lookup API: public tier (plate → basic vehicle facts) and professional tier
- Vehicle taxonomy API endpoint
- `access_scope` column standardised (renamed from `visibility_scope` in ID Auto tables — ✓ done at the schema-source level 2026-08-10, IDA-2A-CORRECTION-0; not yet applied to a live database, pending IDA-2 Phase B)
- Merge/split vehicle_id protocol (resolves R-D01, R-D05)
- First integration: AutoValeur can read vehicle facts via API

**Do not begin concurrently with:**
- Mythos OS Stage 3G (HIGH risk — must have its own deployment window)
- AVA-1

### IDA-3 — Public Vehicle Lookup and Plate Verification

**Status:** NOT STARTED — blocked on IDA-2 complete and R-L01 resolved
**Objective:** Launch the public plate lookup API; verify plate format rules.

**Prerequisites:**
- IDA-2 complete
- Legal basis confirmed (R-L01 — BLOCKING)
- Plate format rules verified against official Tunisian registry

**Scope:**
- Public rate-limited vehicle lookup (anonymous callers)
- Plate format verification and correction
- Carte grise document scan OCR (memory only — no PII stored)
- Contributor submission flow
- PII routing: OCR owner extract → consent → workshop organisation or discard (never to idauto_)

### IDA-4 — Fixpert Smart Gate and Workshop Integration

**Status:** NOT STARTED — blocked on IDA-3 complete; ATN-1 complete; R-L02 resolved
**Objective:** Connect the Fixpert Smart Gate camera to ID Auto observations. Establish the Fixpert–ID Auto vehicle_id linkage.

**Prerequisites:**
- IDA-3 complete
- ATN-1 complete (Atelier Network workshop registry and integration connector)
- Smart Gate ANPR regulatory approval (R-L02 — BLOCKING)
- Fixpert connector specification (ATN-1 scope)

**Scope:**
- Smart Gate camera observation ingestion API (single Fixpert camera — first pilot)
- Fixpert–ID Auto vehicle_id linkage for work orders
- Observation privacy enforcement (MYTHOS_PRIVATE for raw captures, timestamps, location)
- Smart Gate boundary enforcement: Fixpert owns device and consent; ID Auto owns observation
- One workshop, one camera — no generalisation to other workshops in IDA-4

### IDA-5 — Professional Partner Network

**Status:** PLANNED — blocked on IDA-4

### IDA-6 — National Enrichment and Public/Professional Launch

**Status:** FUTURE — blocked on IDA-5; legal framework complete

---

## 5. AutoValeur Stages (AVA-*)

### AVA-0 — Product Foundation

**Status:** COMPLETE — commit 58e0b07

Documents: `AUTOVALEUR_ARCHITECTURE.md`, `AUTOVALEUR_ROADMAP.md`, database schema (18 tables), config.

Architecture decisions confirmed: AD-A1 through AD-A8. Deal Radar write rule confirmed.

### AVA-1 — Valuation Engine v1 and Market Data Foundation

**Status:** NOT STARTED — blocked on IDA-2 complete
**Objective:** Deploy core valuation engine, comparable selection, market range output.

**Prerequisites:**
- IDA-2 complete (vehicle API and shared PostgreSQL cluster)
- First authorised data source contract signed (LEGAL-REVIEW-REQUIRED)
- AutoValeur disclaimer wording approved (R-L03 — BLOCKING)

**Do not begin concurrently with IDA-2.**

### AVA-2 — Professional Tier and Inspection-Adjusted Valuation

**Status:** NOT STARTED — blocked on AVA-1 complete and ATN-1 complete
**Objective:** Integrate Atelier Network inspection data and Parts Network prices into repair-adjusted valuation.

**Prerequisites:**
- AVA-1 complete
- ATN-1 complete (inspection API and repair estimate endpoint available)
- Parts Network price API available (or authorised feed)
- ssangyong.autos integration contract signed (LEGAL-REVIEW-REQUIRED)

**Note on scope (corrected in ATN-0):** AVA-2 depends on the Atelier Network inspection/repair API (ATN-1), not on the Smart Gate camera integration (IDA-4). Smart Gate camera data and inspection/repair estimate data are separate capabilities. AutoValeur consumes the repair estimate from the Atelier Network API — it does not require Smart Gate to be operational.

**Scope:**
- Atelier Network repair estimate ingestion (reads `inspection_provider_id`, `repair_estimate_id`, line items)
- Parts Network price snapshot at quote time
- Repair-adjusted condition report and valuation
- Professional subscriber outputs: purchase price, resale price, margin analysis

### AVA-3 — Model Governance and Manipulation Resistance

**Status:** NOT STARTED — blocked on AVA-2 complete

### AVA-4 — Deal Radar (MYTHOS_PRIVATE)

**Status:** NOT STARTED — blocked on AVA-3 complete and legal governance resolved

### AVA-5 — Completed Sale Price Integration

**Status:** NOT STARTED — blocked on AVA-4 complete and AutoMarket operational

### AVA-6 — External Valuation API and Partner Integrations

**Status:** NOT STARTED — blocked on AVA-5 complete

---

## 6. Parts Network Stages (PNW-*)

Parts Network for ssangyong.autos is a production external system. General Parts Network is a CONCEPT.

- PNW-0: Parts Network specification (CONCEPT stage — not started)
- PNW-1: First authorised parts catalogue integration (LEGAL-REVIEW-REQUIRED)
- PNW-2: Used spare-parts marketplace (LEGAL-REVIEW-REQUIRED)

---

## 7. AutoMarket Verified Stages (AMK-*)

CONCEPT stage.

**Prerequisites for AMK-0 (specification):**
- IDA-3 complete (vehicle lookup for listing verification)
- AVA-1 complete (valuation reference)
- AutoMarket legal framework (R-L05, R-L09)

---

## 8. Fleet Pro and Assistance Stages (FLT-*, AST-*)

Both are CONCEPT stages.

**Fleet Pro prerequisites:**
- IDA-2 complete (vehicle_id API)
- ATN-1 complete (Atelier Network workshop service history)
- Fleet legal framework (LEGAL-REVIEW-REQUIRED)

**Assistance prerequisites:**
- ATN-1 complete (Atelier Network)
- Assistance legal framework (LEGAL-REVIEW-REQUIRED)

---

## 9. Stage Summary Table

| Stage | Product | Status | Blocked on |
|-------|---------|--------|------------|
| MAE-0 | Ecosystem | COMPLETE | — |
| IDA-0 | ID Auto | COMPLETE | — |
| IDA-1 | ID Auto | COMPLETE | — |
| AVA-0 | AutoValeur | COMPLETE | — |
| ATN-0 | Atelier Network | COMPLETE | — |
| **IDA-2** | **ID Auto** | **IN PROGRESS (Phase A complete, Phase B not started)** | **Mythos OS 3D-3F** |
| AVA-1 | AutoValeur | NOT STARTED | IDA-2 |
| ATN-1 | Atelier Network | NOT STARTED | IDA-2, R-ATN-01 |
| MAE-1 | Ecosystem | NOT STARTED | IDA-2 |
| IDA-3 | ID Auto | NOT STARTED | IDA-2, R-L01 |
| AVA-2 | AutoValeur | NOT STARTED | AVA-1, ATN-1 |
| ATN-2 | Atelier Network | NOT STARTED | ATN-1, R-L06 |
| MAE-2 | Ecosystem | NOT STARTED | MAE-1, IDA-3 |
| IDA-4 | ID Auto | NOT STARTED | IDA-3, ATN-1, R-L02 |
| ATN-3 | Atelier Network | NOT STARTED | ATN-2 |
| AVA-3 | AutoValeur | NOT STARTED | AVA-2 |
| MAE-3 | Ecosystem | NOT STARTED | MAE-2 |
| AVA-4 | AutoValeur | NOT STARTED | AVA-3, R-L04 |
| ATN-4 | Atelier Network | NOT STARTED | ATN-3, IDA-4, legal |
| AMK-0 | AutoMarket | NOT STARTED | IDA-3, AVA-1, Legal |
| AVA-5 | AutoValeur | NOT STARTED | AVA-4, AutoMarket |
| ATN-5 | Atelier Network | NOT STARTED | ATN-4, Fleet spec |
| AVA-6 | AutoValeur | NOT STARTED | AVA-5, Legal |
| PNW-0 | Parts | CONCEPT | — |
| FLT-0 | Fleet | CONCEPT | IDA-2, ATN-1 |
| AST-0 | Assistance | CONCEPT | ATN-1 |
| MAE-4 | Ecosystem (Legal) | ONGOING | Legal counsel |

---

## 10. Execution Order (documentation and implementation)

Documentation stages permitted in parallel:
- `3D → 3E → 3F → 3G` — Mythos OS runtimes (next active)
- `IDA-2` — IN PROGRESS (Phase A complete 2026-08-10; Phase B not started, requires separate authorization; after 3F or parallel if not concurrent with 3G)
- `ATN-1` and `AVA-1` — begin after IDA-2; may run in parallel with each other and with IDA-3

Strict sequencing rules:
- IDA-2 must not be concurrent with Mythos OS 3G (HIGH risk)
- AVA-1 must not begin while IDA-2 is active
- ATN-1 may begin with AVA-1 if IDA-2 is complete
- IDA-4 requires IDA-3 complete + ATN-1 complete + R-L02 resolved
- AVA-2 requires AVA-1 complete + ATN-1 complete (not IDA-4)

---

## 11. Critical Path to Alpha

Minimum viable Mythos Automotive Alpha = ID Auto professional API + AutoValeur public valuation.

```
[NOW] ATN-0 docs ──► IDA-2 (PostgreSQL + vehicle API)
                          │
                          ├──► AVA-1 (valuation engine v1)
                          │         └── ALPHA REACHED ──►
                          │
                          ├──► ATN-1 (workshop registry + inspection API)
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
