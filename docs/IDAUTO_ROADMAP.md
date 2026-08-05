# ID Auto — Roadmap

**Product:** ID Auto  
**Domain:** idauto.tn  
**Last updated:** 2026-08-05

---

## Stages

### IDA-0 — Foundation ✓ Current

**Status:** Complete (2026-08-05)  
**Commit:** see `docs/AI_HANDOVER.md`

**Deliverables:**
- `projects/idauto/README.md` — product identity, privacy contract, plate format catalogue
- `projects/idauto/config/idauto.example.json` — configurable plate-format rules, feature flags, integration stubs
- `projects/idauto/database/schema.sql` — 11-table data contract (vehicles, plates, sources, verifications, service-events, organizations, user-roles, consent/legal-basis, audit-log)
- `docs/IDAUTO_ARCHITECTURE.md` — 7 architecture decisions, integration contracts, data flow diagrams
- `docs/IDAUTO_ROADMAP.md` — this file

**Scope exclusions confirmed:** no real data, no UI, no deployment, no personal-data exposure.

---

### IDA-1 — Product and Legal Specification

**Status:** Planned  
**Depends on:** IDA-0

**Objective:** Define the legal and product specification required before any data ingestion or API development begins.

**Deliverables:**
- Legal basis document: mapping each data category to its legal ground under Tunisian organic law 63-2004 and GDPR adequacy framework
- Data-processing agreement template for professional subscribers
- Regulatory pathway for accessing public vehicle registry data (Agence Technique des Transports Terrestres or equivalent)
- Privacy notice draft (Arabic + French) for public users and professional subscribers
- API specification: endpoint definitions, request/response schemas, error codes, rate-limit headers
- Hosting and infrastructure specification (DBMS choice, server, TLS, CDN)
- Data retention policy: verification logs (90 days), audit log (7 years), service events (retention period TBD with legal)
- Acceptance criteria for IDA-2

---

### IDA-2 — MVP Plate Search API

**Status:** Planned  
**Depends on:** IDA-1 legal review complete, hosting decision

**Objective:** Deploy a working public plate-search API with a test dataset. No real owner data.

**Deliverables:**
- API server (PHP or Node.js, same VPS or separate depending on IDA-1 decision)
- `GET /v1/plates/{plate}` — public endpoint, returns vehicle attributes, no PII
- Rate limiter backed by `idauto_verifications`
- Plate format validator using `idauto_plate_formats` catalogue
- Audit logging to `idauto_audit_log`
- Mythos OS auth integration for authenticated (non-professional) callers
- Mythos OS audit integration
- 50+ automated tests (format validation, rate limiting, response field filtering, audit log assertions)
- Test dataset: synthetic plates only, no real vehicles or owners

---

### IDA-3 — Professional Subscription Portal

**Status:** Planned  
**Depends on:** IDA-2

**Objective:** Enable verified organizations to subscribe, authenticate, and access professional-tier features.

**Deliverables:**
- Organization registration flow (name, tax ID, type, governorate)
- Verification workflow (manual admin approval in IDA-3; automated in future)
- Professional API tier: higher rate limits, service-event write/read
- Mythos OS billing integration (subscription plans, renewal)
- Mythos OS notifications integration (renewal reminders, alerts)
- Consent management UI (professional subscriber consent recording)
- Admin dashboard: organization list, status management, audit log viewer
- 50+ automated tests

---

### IDA-4 — Service Event Tracking and Fleet Integration

**Status:** Planned  
**Depends on:** IDA-3

**Objective:** Build the service-history layer for professional subscribers.

**Deliverables:**
- `POST /v1/vehicles/{id}/service-events` — write service event (garage tier)
- `GET /v1/vehicles/{id}/service-events` — read service history (professional tier)
- Fleet manager dashboard: vehicle list with service event timeline
- Document attachment: link Mythos OS documents to service events
- Mythos OS search integration: ID Auto plates as searchable entities
- Data export: fleet CSV / PDF service history
- 50+ automated tests

---

### IDA-5 — Public Launch and Data Enrichment

**Status:** Future  
**Depends on:** IDA-4, legal framework complete, data-source agreement signed

**Objective:** Populate the plate catalogue from authorised public registry sources and launch idauto.tn publicly.

**Deliverables:**
- Data ingestion pipeline from authorised source (gazette, ATTT, or equivalent)
- Deduplication and conflict-resolution rules
- Public-facing web search UI (idauto.tn)
- Mobile-optimised search (QR code scan to plate lookup)
- Analytics dashboard (aggregate, never individual-level PII)
- SLA and uptime monitoring
- Public launch

---

## Cross-Product Dependency Map

```
Mythos OS (existing, production)
    │
    ├── Auth service       ──────────────────────► ID Auto IDA-2+
    ├── Billing service    ──────────────────────► ID Auto IDA-3+
    ├── Documents service  ──────────────────────► ID Auto IDA-4+
    ├── Notifications      ──────────────────────► ID Auto IDA-3+
    ├── Search (MythosSearch) ───────────────────► ID Auto IDA-4+
    └── Audit service      ──────────────────────► ID Auto IDA-2+
```

ID Auto does not modify or depend on any Mythos OS `mp_*` storage tables. The dependency is service-consumption only, via defined contracts.

---

## Priority Relationship with Mythos OS Stage 4

Mythos OS Stage 4 (app.js extraction) remains the **active priority**. The next Mythos OS stage is **Stage 4AG** (Invoice/OM helper duplicates audit). ID Auto roadmap stages do not block or delay Stage 4AG.

ID Auto IDA-1 may begin in parallel with Stage 4AG only if Stage 4AG is complete or explicitly paused by the user.
