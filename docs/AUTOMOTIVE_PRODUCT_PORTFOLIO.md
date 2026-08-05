# Mythos Automotive — Product Portfolio

**Stage:** MAE-0 Ecosystem Master Foundation
**Last updated:** 2026-08-05
**Repository:** othoth77/mythos-prod

---

## 1. Portfolio Status Legend

| Status | Meaning |
|--------|---------|
| FOUNDATION | Foundation stage complete — ownership, architecture, governance defined |
| SPECIFIED | Product fully specified — build gate ready |
| BUILD | Active implementation underway |
| PILOT | Limited authorised deployment |
| BETA | Wider deployment with active monitoring |
| PRODUCTION | Live, monitored, backed up, supported |
| CONCEPT | Planned product — not yet specified |
| PAUSED | Deprioritised or blocked |
| RETIRED | No longer active |

---

## 2. Platform — Mythos OS Core

**Status:** PRODUCTION (Stage 4 extraction in progress)
**Domain:** mythos-os (current production deployment)
**Owner:** Mythos Prod

**Role:**

Mythos OS is the shared platform providing authentication, session management, roles and permissions, global audit, notifications, document storage, billing references, search, and administration. It is the foundation all automotive products sit on.

Mythos OS is not an automotive product. It does not own vehicles, customers, valuations, or spare parts. It owns platform users (Mythos accounts), organisations (subscribed entities), global roles, service accounts, and integration registry.

**Current state:**

- Production deployment active
- Stage 4 extraction in progress: reducing legacy `js/app.js`, moving responsibilities into `js/shared/` and `js/plugins/`
- Stages 3D → 3G pending (Planning, Calendar, Dashboard, Production runtimes)
- `stableLineCount` collision (mission-orders.js vs invoices.js) documented, reserved for dedicated stage

**Permanent constraints:**

- Do not touch `/var/www/uthinachess/0726/Prod/`
- Do not restart nginx or PHP
- Do not deploy uncommitted code

---

## 3. Core Pillar A — ID Auto

**Status:** FOUNDATION (IDA-1 complete)
**Domain:** idauto.tn
**Owner:** Mythos Prod
**Repository path:** `projects/idauto/`, `docs/IDAUTO_*.md`

**Role:**

ID Auto is the canonical vehicle identity platform for Tunisia. It is the single source of truth for `vehicle_id`. Every other product that references a vehicle does so through ID Auto's canonical identifier.

**Owns:**
- `vehicle_id` (canonical, stable, opaque)
- Plate identities and plate-to-vehicle links
- Authorised VIN facts (where legally obtained)
- Vehicle observations (immutable, provenance-traced)
- Verified technical facts (versioned, evidence-backed)
- Vehicle taxonomy: make/model/variant/fuel/body_type/category/governorate
- Capture sessions, confidence scores, review queue
- Smart Gate vehicle movement events (MYTHOS_PRIVATE)
- Document scans (carte grise — no PII stored, PII never exported)

**Does not own:**
- Customers or owner PII (routes to Fixpert with consent)
- Valuations (AutoValeur)
- Parts orders (Parts Network)
- Marketplace listings (AutoMarket)

**Current stage:** IDA-1 complete. Next: IDA-2 — PostgreSQL Core, API and Manual Capture MVP.

**Integration rule:** All other products reference vehicles only by `vehicle_id`. Only ID Auto creates, merges, or retires vehicle fiches.

---

## 4. Core Pillar B — Fixpert Atelier

**Status:** PRODUCTION (external system, integration specified)
**Domain:** Fixpert (existing business)
**Owner:** Fixpert (external)
**Repository coverage:** Integration contracts defined; `fixpert` schema documented in comments but not created by this repository

**Role:**

Fixpert is the first professional partner and workshop pilot. It is the operational authority for vehicle repair, inspection, maintenance, and all customer-facing workshop workflow.

**Owns:**
- Customers (including owner PII routed from carte grise with consent)
- Appointments and workshop reception
- Inspections and diagnostic results
- Work orders and intervention records
- Labour hours and labour costs
- Workshop quotations
- Workshop invoices
- Workshop payments
- Workshop employees and operational records
- Customer consent records for PII handling

**Does not own:**
- Vehicle identity (consumes from ID Auto)
- Market valuations (consumes from AutoValeur)
- Parts catalogue (consumes from Parts Network; may reference)

**Smart Gate boundary:**
- Fixpert owns the physical camera device and the consent obligation toward vehicles and their owners
- ID Auto owns the resulting observation record created from Smart Gate events
- Smart Gate events are MYTHOS_PRIVATE

**Mythos Super Admin access:**
- Mythos Super Admin may read Fixpert operational data under governance rules
- Every such access is audit-logged
- Super Admin visibility does not change Fixpert's legal ownership of invoices, customers, or workshop records

**Integration specification stage:** IDA-4 (Smart Gate), AVA-2 (inspection data for valuation)

---

## 5. Core Pillar C — Parts Network

**Status:** PRODUCTION (ssangyong.autos external), CONCEPT (general platform)
**Domain:** ssangyong.autos (existing); future general platform (not yet defined)
**Owner:** External / Mythos Prod (future)
**Repository coverage:** Referenced as external data source; no runtime code in this repository

**Note:** ssangyong.autos is an existing external commercial system. Its source code is NOT in this repository. It is treated as an external data source subject to LEGAL-REVIEW-REQUIRED before any integration.

**Role:**

Parts Network is the commerce and catalogue domain for spare parts. It powers the parts sourcing step in the vehicle reconditioning chain and provides price inputs to AutoValeur repair estimates.

**Owns:**
- Canonical `part_id`
- OEM and alternative part references
- Vehicle fitment/compatibility catalogue
- Supplier registry
- Stock locations and availability
- Purchase price and selling price
- Delivery estimates
- Parts orders and fulfilment references
- Condition: new / used / refurbished
- Storefront channel configuration

**Storefronts:**

Parts Network may support multiple storefronts (ssangyong.autos, brand-specific sites, future multibrand site, professional B2B portal). Storefronts are sales channels, not separate catalogues. One shared platform where practical.

**Does not own:**
- Vehicle identity (receives compatibility queries from ID Auto taxonomy)
- Valuations (supplies price inputs to AutoValeur via authorised quote)
- Fixpert customer data

**Integration rule:** AutoValeur stores a parts price **snapshot at quote time** (source + date + price). It does not maintain a synchronised copy of the Parts Network catalogue. The Parts Network catalogue is the live source.

**Integration specification stage:** AVA-2 (ssangyong.autos parts price lookup)

---

## 6. Core Pillar D — AutoValeur

**Status:** FOUNDATION (AVA-0 complete)
**Domain:** Not yet confirmed
**Owner:** Mythos Prod
**Repository path:** `projects/autovaleur/`, `docs/AUTOVALEUR_*.md`

**Role:**

AutoValeur is the market valuation and intelligence authority. It produces vehicle valuations as ranges with supporting metrics, not as single numbers. It is the only product that produces and stores valuation records.

**Owns:**
- Valuation records (immutable snapshots)
- Comparable analysis results
- Condition report inputs
- Repair estimate records (authorised references only)
- Liquidity scores
- Opportunity scores
- Deal alerts and deal pipeline (MYTHOS_PRIVATE)
- Valuation model versions and evaluations
- Market listing snapshots (authorised sources only)
- Audit events

**Does not own:**
- Vehicle identity (references ID Auto)
- Customer PII (references Fixpert by stable ID only)
- Parts catalogue (references Parts Network by price snapshot)
- Marketplace listings (references by external stable ID only)

**Valuation output invariants:**
- Always a range, never a single number
- Every result carries a model version
- Asking price and completed sale price always stored in separate fields
- Deal Radar is MYTHOS_PRIVATE — no automatic purchase, no automatic seller contact

**Integration correction (from architecture audit):**
The Deal Radar pipeline may identify vehicles with no existing ID Auto fiche. In this case, AutoValeur **submits an ingestion request to ID Auto's review queue** — it does not write directly to any `idauto_` table. Only ID Auto creates vehicle fiches under its observation-first invariant.

**Current stage:** AVA-0 complete. Next: AVA-1 — Public Calculator MVP (requires IDA-2 to provision PostgreSQL cluster).

---

## 7. Near-Term Planned Products

### 7.1 AutoCheck by Fixpert

**Status:** CONCEPT
**Domain:** TBD
**Owner:** Mythos Prod + Fixpert

**Role:**

AutoCheck is a pre-purchase inspection service and report standard, delivered by Fixpert and shared across the ecosystem.

**Inspection sections:**
- Identity and documents
- Diagnostic scan (fault codes)
- Engine condition
- Gearbox condition
- Braking system
- Suspension and steering
- Tyres
- Battery (including EV/hybrid)
- Electrical systems
- Air conditioning
- Bodywork and paint
- Road test
- Immediate repair requirements
- Future repair timeline
- Parts estimate
- Labour estimate
- Risk notes

**Report outputs consumed by:**
- AutoValeur (post-inspection revised valuation)
- AutoMarket Verified (inspection badge on listing)
- Professional buyer (purchase decision)
- Fleet operators (fleet condition assessment)

**Display wording:**
- "AutoCheck by Fixpert" — for the report product
- "Inspecté par Fixpert" — for the inspection badge
- "Estimation après inspection Fixpert" — for valuation updates
- **Never:** "Expertise légale certifiée" (without future legal authorisation)

**Specification stage:** Deferred to dedicated stage

---

### 7.2 AutoMarket Verified

**Status:** CONCEPT
**Domain:** TBD
**Owner:** Mythos Prod

**Role:**

AutoMarket Verified is a general vehicle marketplace with integrated ID Auto identity, AutoValeur pricing, and optional AutoCheck inspection.

**Differentiators:**
- Listing must link to a confirmed ID Auto `vehicle_id`
- AutoValeur price analysis shown alongside asking price
- Optional AutoCheck report badge
- Verified listing status (precise, not a single vague badge)
- Completed sale feedback returned to AutoValeur
- No public owner identity
- No public vehicle movement history

**Listing statuses:**
- `draft`
- `pending_review`
- `published`
- `reserved`
- `under_negotiation`
- `sold`
- `withdrawn`
- `rejected`
- `archived`

**Verification badges (precise meanings required):**
- `identity_checked` — plate matched to ID Auto vehicle_id
- `documents_reviewed` — carte grise verified
- `inspected_by_fixpert` — AutoCheck report exists
- `price_analysed` — AutoValeur analysis linked
- `repairs_disclosed` — repair estimate attached
- `transaction_completed` — completed on platform

**Owns:**
- Listings and seller-managed content
- Leads, offers, accepted offers
- Completed transaction records
- Listing performance data

**Does not own:**
- Vehicle identity (must link to ID Auto)
- Seller PII in public outputs
- Valuation model

---

## 8. Future Products

### 8.1 Fleet Pro

**Status:** CONCEPT

Fleet management platform for professional operators:
- Fleet vehicle membership and policy
- Maintenance schedules and cost tracking
- Cost per vehicle and cost per kilometre
- Downtime and utilisation analysis
- Mileage tracking
- Parts consumption
- Fleet valuation (AutoValeur integration)
- Repair-or-sell decision support

### 8.2 Fixpert Assistance

**Status:** CONCEPT

Roadside assistance and incident management:
- Assistance case management
- Towing dispatch
- Battery assistance
- Tyre assistance
- Transport to Fixpert workshop
- Fleet assistance contracts

### 8.3 EV and Hybrid Center

**Status:** CONCEPT

Specialised services for electric and hybrid vehicles:
- Battery health diagnostic and report
- EV/hybrid-specific fault code reading
- Charging equipment installation and service
- Battery-related valuation factors
- Specialised parts and maintenance

---

## 9. Long-Range Optional Extensions

These are portfolio opportunities, not authorised implementation stages. They require separate business decisions, legal review, and explicit authorisation.

- Mechanical warranty partnerships
- Insurance integration
- Financing and leasing comparison
- Vehicle trade-in programme
- B2B auction and remarketing
- Supplier marketplace
- Parts logistics and fulfilment
- Automotive training academy
- Telematics and connected fleet services
- Import/export support services
- Authorised professional data products
