# ID Auto — Roadmap

**Product:** ID Auto
**Domain:** idauto.tn
**Platform:** Mythos ecosystem
**Last updated:** 2026-08-05

---

## Stages

### IDA-0 — Foundation ✓ Complete

**Status:** Complete (2026-08-05)

**Deliverables:**
- `projects/idauto/README.md` — product identity, privacy contract, plate format catalogue
- `projects/idauto/config/idauto.example.json` — configurable rules and feature flags
- `projects/idauto/database/schema.sql` — initial data contract draft (11 tables)
- `docs/IDAUTO_ARCHITECTURE.md` — architecture decisions, integration contracts
- `docs/IDAUTO_ROADMAP.md` — this file

**Scope:** No real data, no UI, no deployment, no personal-data exposure.

---

### IDA-1 — Product Vision, Capture, Access and Data Governance Specification ✓ Current

**Status:** Complete (2026-08-05)

**Objective:** Define the product vision, data capture model, access scopes, Fixpert integration boundaries, and governance constraints before any implementation begins.

**Deliverables:**
- `docs/IDAUTO_PRODUCT_SPEC.md` — product vision, user groups, access matrix, data ownership, vehicle fiche lifecycle, contribution model, super-admin role
- `docs/IDAUTO_CAPTURE_PIPELINE.md` — scanner modes, observation-first flow, plate scan, carte grise OCR, confidence and evidence, conflict handling, review queue, media/location privacy
- `docs/IDAUTO_FIXPERT_INTEGRATION.md` — five-camera context, Smart Gate flow, data ownership boundaries, Fixpert Atelier relationship, deployment prerequisites
- Updated `projects/idauto/README.md` — aligned to Mythos ecosystem, observation-first model
- Updated `projects/idauto/config/idauto.example.json` — v0.2.0-ida1-draft, full configuration sections
- Updated `projects/idauto/database/schema.sql` — 22-table observation-first draft specification
- Updated `docs/IDAUTO_ARCHITECTURE.md` — PostgreSQL target, logical schema separation, three access scopes, new ADs
- Updated `docs/IDAUTO_ROADMAP.md` — this file, IDA-0 through IDA-6

**Key decisions:**
- ID Auto is a Mythos ecosystem product, not an isolated platform
- PostgreSQL selected as target DBMS (not yet installed)
- Observation-first data model (AD-8)
- Three access scopes: PUBLIC, PROFESSIONAL, MYTHOS_PRIVATE (AD-9)
- Smart Gate is MYTHOS_PRIVATE by design (AD-10)
- Plate format rules are UNVERIFIED DRAFTS until confirmed against official source
- LEGAL-REVIEW-REQUIRED items explicitly listed

**Scope exclusions confirmed:** no pipeline code, no OCR, no camera connection, no PostgreSQL, no real data, all feature flags remain `false`.

---

### IDA-2 — PostgreSQL Core, API and Manual Capture MVP

**Status:** Planned
**Depends on:** IDA-1 complete

**Objective:** Deploy the PostgreSQL database, implement the core API, and enable admin manual entry for the first test vehicles.

**Deliverables:**
- Target PostgreSQL cluster deployed with `idauto` schema
- Core API: vehicle, plate, observation, fact and evidence endpoints
- Admin manual entry (private, no public ingestion)
- Review queue UI (admin)
- Plate format validation
- Audit logging
- Object storage wiring (original image references)
- Mythos OS auth integration
- Mythos OS audit integration
- Rate limiting backed by `idauto_verifications`
- Synthetic and authorised pilot data only
- 50+ automated tests

**Exclusions:** no public capture, no carte grise OCR, no Smart Gate, no professional subscriptions.

---

### IDA-3 — Public Smart Scanner and Carte Grise Workflow

**Status:** Planned
**Depends on:** IDA-2 API deployed; LEGAL-REVIEW-REQUIRED items resolved for: public image contribution, precise GPS collection, public plate lookup, carte grise OCR, contributor consent

**Objective:** Open the public capture surface — Scanner button, plate/vehicle scan, carte grise OCR — with full privacy controls and the review queue.

**Deliverables:**
- "Scanner un véhicule" button and scanner modes (plate, vehicle, carte grise, import)
- Image quality check, object detection, plate OCR, colour and category detection
- Carte grise OCR with mandatory confirmation form and consent flow
- Owner PII handling (route to Fixpert or discard; never store in idauto schema)
- Contributor accounts, trust score, rate limiting
- Public contribution privacy notice (Arabic + French)
- Deduplication (image hash + plate + time window)
- Review queue populated from public submissions
- Mythos OS notifications integration (review alerts)
- 50+ automated tests

---

### IDA-4 — Fixpert Smart Gate and Atelier Integration

**Status:** Planned
**Depends on:** IDA-3; LEGAL-REVIEW-REQUIRED resolved for: ANPR regulatory approval, camera disclosure, video retention

**Objective:** Activate the Fixpert Smart Gate on the single designated entrance/exit camera.

**Deliverables:**
- RTSP stream integration (single camera, Fixpert)
- ANPR model integration and calibration
- Entry/exit deduplication (configurable window)
- Direction inference
- `idauto_vehicle_movements` population (MYTHOS_PRIVATE)
- Fixpert Atelier work order link (optional, vehicle_id reference)
- Camera source credential management
- Mythos OS documents integration (carte grise protected storage)
- Mythos OS search integration (ID Auto plates as searchable entities)
- Fixpert professional subscriber onboarding
- 50+ automated tests

**Scope:** One camera only. No other Fixpert cameras. No public movement data.

---

### IDA-5 — Professional Partner Network

**Status:** Planned
**Depends on:** IDA-4

**Objective:** Expand professional access beyond Fixpert to a broader partner network.

**Deliverables:**
- Garage / insurer / fleet / field-team subscription tiers
- Partner onboarding and verification workflow
- Professional field team data collection (authorised capture sources)
- Source quality scoring updated from submission outcomes
- Regional coverage dashboards (by governorate — aggregate only)
- Partner APIs for service event write
- Mythos OS billing integration (subscription plans, renewal)
- Data-source scoring
- 50+ automated tests

---

### IDA-6 — National Enrichment and Public/Professional Launch

**Status:** Future
**Depends on:** IDA-5; legal framework complete; data-source agreement signed with authorised official source (ATTT or equivalent)

**Objective:** Populate the plate and vehicle catalogue from authorised public registry sources and launch idauto.tn publicly.

**Deliverables:**
- Official source data ingestion pipeline
- Deduplication and conflict-resolution rules for imported data
- Public search UI at idauto.tn
- Mobile-optimised search (QR code scan to plate lookup)
- Professional subscription portal (public onboarding)
- Analytics dashboard (aggregate, never individual-level PII)
- SLA and uptime monitoring
- Nationwide partner coverage campaigns
- Public launch

**Exclusions (permanent):** Public tracking of individual vehicles or persons. Individual movement history exposure.

---

## Strategic Growth Milestones

These are strategic targets, not guaranteed forecasts. Each depends on legal approvals and partner agreements.

| Milestone | Target vehicles | Method |
|---|---|---|
| Pilot | 1,000 | Admin manual entry, synthetic test data, correction cycle |
| Early growth | 10,000 | Fixpert Smart Gate + first professional partners |
| Network scale | 100,000 | Professional field network, partner contributions |
| National scale | 500,000+ | Authorised official source ingestion + nationwide partnerships |

---

## Cross-Product Dependency Map

```
Mythos OS (existing, production)
    │
    ├── Auth service        ─────────────────► ID Auto IDA-2+
    ├── Billing service     ─────────────────► ID Auto IDA-3+
    ├── Documents service   ─────────────────► ID Auto IDA-4+
    ├── Notifications       ─────────────────► ID Auto IDA-3+
    ├── Search (MythosSearch) ───────────────► ID Auto IDA-4+
    └── Audit service       ─────────────────► ID Auto IDA-2+

Fixpert Atelier
    └── work_orders.vehicle_id ──────────────► idauto.vehicles.id (IDA-4+)
```

ID Auto does not modify Mythos OS `mp_*` tables. Fixpert business data stays in the `fixpert` schema. The dependency is service-consumption only via defined contracts.

---

## LEGAL-REVIEW-REQUIRED (open items before IDA-3/IDA-4 activation)

| Item | Blocking stage |
|---|---|
| Public image contribution — legal basis in Tunisia | IDA-3 |
| Precise GPS collection — consent and notice requirements | IDA-3 |
| Public plate lookup service — legal basis | IDA-3 |
| Carte grise OCR — processing basis and consent flow | IDA-3 |
| Contributor consent design — formal mechanism | IDA-3 |
| ANPR cameras — INPDP notification or approval | IDA-4 |
| Camera disclosure to visitors / employees | IDA-4 |
| Video retention periods under Tunisian law | IDA-4 |
| Official data-source agreement (ATTT or equivalent) | IDA-6 |
| Data retention final periods (all categories) | IDA-2 (interim) |
| Data correction / deletion rights (individuals) | IDA-3 |
| Professional data sharing legal basis | IDA-2 |
| Mythos Super Admin access governance policy | IDA-2 |
