# Mythos Automotive — Product Portfolio

**Stage:** ATN-0 Atelier Network Foundation and Ecosystem Consistency Amendment (amends MAE-0)
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
**Repository:** https://github.com/othoth77/idauto (canonical since 2026-08-18; the duplicated tree here was removed by IDA-DECOUPLE-4 — see `docs/IDAUTO_STANDALONE_MIGRATION.md`)

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

## 4. Core Pillar B — Atelier Network

**Status:** FOUNDATION (ATN-0 complete)
**Product key:** `atelier_network`
**Owner:** Mythos Prod
**Repository path:** `projects/atelier-network/`, `docs/ATELIER_NETWORK_*.md`

**Role:**

Mythos Atelier Network is the generic multi-workshop platform. It provides the registry, inspection standard (AutoCheck), integration connectors, and operational API for vehicle repair workshops, inspection centres, and maintenance service providers — of any workshop type or digital maturity.

**Fixpert is the first workshop pilot.** Fixpert is an existing external operational system predating the Atelier Network platform. It operates as an `EXTERNAL_CONNECTED` workshop (integration mode to be confirmed in ATN-1). Fixpert's existing source code is not in this repository.

**Owns (platform and registry):**
- Workshop organisation registry
- Workshop registry (brands, sites)
- Network membership records
- Integration connectors (NATIVE_MANAGED / EXTERNAL_CONNECTED / HYBRID)
- Workshop capabilities and accreditations
- Service catalogue (generic metadata)
- Inspector and technician registry
- AutoCheck standard governance and accreditation
- Inspection provider registry
- Smart Gate device registry
- Network-level audit events
- Repair estimates (inspection output — consumed by AutoValeur)

**Each workshop organisation owns (their data, organisation_private):**
- Customer records and PII
- Customer consent records
- Appointment business data (customer-linked details)
- Work order financial totals and invoices
- Payment records

**Does not own:**
- Vehicle identity (references ID Auto vehicle_id — mandatory for all work orders and inspections)
- Market valuations (AutoValeur consumes repair estimates from Atelier Network)
- Parts catalogue (references Parts Network by snapshot)

**Smart Gate boundary (generalised in ATN-0):**
- Each participating workshop owns its physical Smart Gate device and the consent/notice obligation toward vehicles and their owners
- ID Auto owns the resulting observation record produced by any Smart Gate device
- All Smart Gate observations are MYTHOS_PRIVATE
- IDA-4 scope: first Smart Gate pilot at Fixpert (one camera only)
- Future Smart Gate at other workshops: governed by ATN-4 + per-workshop legal approval

**Workshop Types:**
`OWNED` / `BRANCH` / `FRANCHISE` / `PARTNER` / `AUTHORIZED_INSPECTION` / `MOBILE_SERVICE`

**Integration Modes:**
`NATIVE_MANAGED` / `EXTERNAL_CONNECTED` / `HYBRID`

**Current stage:** ATN-0 complete. Next: ATN-1 — Core API, Workshop Registry and First Integration.

---

### 4.1 Fixpert — First Workshop Pilot

**Status:** PRODUCTION (external system, integration mode to be confirmed in ATN-1)
**Domain:** Fixpert (existing business)
**Owner:** Fixpert (external)
**Repository coverage:** No Fixpert runtime code in this repository. Integration contracts defined. `fixpert` schema documented in comments but not created by this repository.

**Current role (relative to Atelier Network):**

Fixpert is an existing production workshop system that will be the first `EXTERNAL_CONNECTED` pilot on the Atelier Network platform. Its existing operational data (customers, appointments, work orders, invoices) is in its own external system.

**Fixpert owns (its own operational data):**
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

**Integration specification stages:**
- IDA-4: Smart Gate camera integration (first pilot)
- ATN-1: Fixpert as first EXTERNAL_CONNECTED workshop connector
- AVA-2: Atelier Network repair estimate API consumed by AutoValeur (not Fixpert direct)

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

### 7.1 AutoCheck Standard

**Status:** CONCEPT / DRAFT STANDARD
**Governed by:** Mythos Atelier Network
**Owner:** Mythos Prod (standard governance) + accredited provider (delivery)

**Role:**

AutoCheck is the provider-neutral pre-purchase inspection protocol and condition report standard. It is governed by Mythos Atelier Network. Any accredited workshop may deliver an AutoCheck inspection and report under this standard.

**Fixpert is the first accredited AutoCheck provider.**

**Report branding:**
- "AutoCheck by Fixpert" — when Fixpert delivers the inspection
- "AutoCheck — [Workshop Name]" — when any other accredited provider delivers the inspection
- "Inspecté par Fixpert" / "Inspecté par [Workshop Name]" — inspection badge wording
- "Estimation après inspection [Workshop Name]" — for AutoValeur valuation updates
- **Never:** "Expertise légale certifiée" (without future legal authorisation — R-L06 open)

**17 inspection sections:**
Identity and Documents, Diagnostic Scan, Engine, Gearbox, Brakes, Suspension and Steering, Tyres, Battery/EV, Electrical, Air Conditioning, Bodywork and Paint, Road Test, Immediate Repair Requirements, Future Repair Timeline, Parts Estimate, Labour Estimate, Risk Notes.

**Report outputs consumed by:**
- AutoValeur (post-inspection revised valuation via Atelier Network repair estimate API)
- AutoMarket Verified (inspection badge on listing)
- Professional buyer (purchase decision)
- Fleet operators (fleet condition assessment)

**Full protocol:** See `docs/AUTOCHECK_STANDARD.md`

**Specification stage:** ATN-1 (accreditation registry + API); ATN-2 (first report issued)

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
