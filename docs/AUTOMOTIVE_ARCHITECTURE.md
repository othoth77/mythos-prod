# Mythos Automotive — Master Architecture

**Stage:** MAE-0 Ecosystem Master Foundation
**Last updated:** 2026-08-05
**Repository:** othoth77/mythos-prod

---

## 1. Architecture Overview

Mythos Automotive is a portfolio of independent product domains sharing a governance layer and common platform services. Each product has its own business boundary, its own PostgreSQL schema, its own release cadence, and its own data ownership.

```
Mythos Automotive Portfolio
│
├── Mythos OS Core (mythos_core schema)
│   Platform services: auth, roles, audit, billing, notifications, search, documents
│
├── ID Auto (idauto schema)
│   Vehicle identity: fiches, plates, observations, facts, evidence, Smart Gate
│
├── Fixpert Atelier (fixpert schema — external, integration only)
│   Workshop: customers, appointments, inspections, work orders, invoices, payments
│
├── Parts Network (parts schema — future)
│   Commerce: parts catalogue, compatibility, suppliers, stock, orders, storefronts
│
├── AutoValeur (autovaleur schema)
│   Market: valuations, comparables, scores, deal pipeline, model versions
│
├── AutoMarket (automarket schema — future)
│   Marketplace: listings, offers, transactions
│
├── Fleet (fleet schema — future)
│   Fleet management
│
└── Assistance (assistance schema — future)
    Roadside services
```

**Target DBMS: PostgreSQL** — one shared cluster, logically separated by schema, with cross-schema access governed by the control plane. **PostgreSQL is NOT installed or deployed in MAE-0.**

---

## 2. Master Architecture Decisions

### MAD-1 — Product-Schema Alignment

**Decision:** Each product domain maps to one logical PostgreSQL schema. A product's tables live in its own schema. No table lives in two schemas.

**Why:** Schema boundaries enforce product ownership at the database layer. An application that does not have a GRANT on a schema cannot accidentally read or write it.

**Enforcement:** All `idauto_` tables live in the `idauto` schema. All `autovaleur_` tables in `autovaleur`. The `mythos_core` schema owns platform tables. The `fixpert` schema is documented as external; it is not created by this repository's migration scripts.

**Note on table naming:** Within a PostgreSQL schema, the schema-prefix in a table name is redundant (e.g. `idauto.idauto_vehicles`). Future DDL migrations should consider dropping the product prefix inside the schema (e.g. `idauto.vehicles`). Existing draft schemas retain the current naming convention pending this decision.

---

### MAD-2 — Canonical Vehicle Identifier is Owned Exclusively by ID Auto

**Decision:** `vehicle_id` is issued, managed, merged, and retired exclusively by ID Auto. No other product creates a vehicle record. No other product issues a vehicle identifier.

**Why (from architecture audit):** Three products already reference vehicles through ad-hoc integer columns with no central identifier specification. A merge or split of an ID Auto fiche silently repoints or orphans valuations and work orders. This is the highest-cost failure mode to fix late.

**Enforcement:**
- `autovaleur_valuations.idauto_vehicle_id` is a cross-schema reference. Its referential integrity is enforced by the application, not a database FK.
- AutoValeur's Deal Radar may discover vehicles not yet in ID Auto. In this case, AutoValeur **submits an ingestion request to ID Auto's review queue**. It does not write to any `idauto_` table. Only ID Auto processes the observation and creates the fiche.
- Fixpert references vehicles by `idauto_vehicle_id` in its work orders. Fixpert never creates competing vehicle records.
- Every cross-product reference to a vehicle must carry the canonical `vehicle_id`. Local caches (e.g. `idauto_snapshot_json` in AutoValeur) are explicitly labelled as point-in-time snapshots, never re-read as current truth.

---

### MAD-3 — One Writer Per Business Noun

**Decision:** Only the owning product writes to its own tables. Cross-product data flows are read-only references or events submitted to the owning product's ingestion API.

**Noun-to-owner table:**

| Noun | Owner |
|------|-------|
| Vehicle fiche, vehicle_id | ID Auto |
| Plate identity | ID Auto |
| Vehicle observation | ID Auto |
| Vehicle fact | ID Auto |
| Vehicle taxonomy (make/model/variant/fuel/body_type) | ID Auto |
| Customer/client PII | Fixpert |
| Appointment, inspection | Fixpert |
| Work order, intervention | Fixpert |
| Invoice, payment | Fixpert |
| Part, part_id, compatibility | Parts Network |
| Parts stock, order | Parts Network |
| Valuation, comparable | AutoValeur |
| Market listing snapshot | AutoValeur |
| Opportunity score | AutoValeur |
| Marketplace listing (live) | AutoMarket |
| Completed transaction record | AutoMarket |
| Platform user, org | Mythos Core |
| Role, permission | Mythos Core |
| Audit event (cross-product) | Mythos Core |

---

### MAD-4 — No Cross-Schema FK Constraints

**Decision:** Foreign keys do not cross schema boundaries. Cross-schema references are stored as plain BIGINT or UUID columns with application-level integrity enforcement and periodic orphan detection.

**Why:** Schema separation allows independent migrations. Cross-schema FKs create a hard coupling that defeats the purpose of schema isolation and blocks independent deployment.

**Enforcement:** Every cross-schema reference is documented with a comment identifying its target table. Orphan detection (references that no longer point to a live record) is an application-level responsibility and must be observable.

---

### MAD-5 — Unified Access Scope Model

**Decision:** The three access scopes PUBLIC / PROFESSIONAL / MYTHOS_PRIVATE apply across all products. The scope column is named `access_scope` in all tables (not `visibility_scope` or `is_public`).

**Scope definitions:**

| Scope | Who | Audit required |
|-------|-----|----------------|
| `public` | Any caller within rate limits | No |
| `professional` | Verified subscriber organisations | No |
| `mythos_private` | Mythos Super Admin only | Yes — every access logged |

**Additional operational scopes:**

| Scope | Meaning |
|-------|---------|
| `product_internal` | Not exposed outside the owning product's API |
| `organization_private` | Visible within one organisation only |
| `consent_shared` | Shared to a specific product with explicit subject consent |

**Important distinction:** Visibility and ownership are different. A Fixpert invoice may be visible to an authorised Mythos Super Admin (access_scope = `mythos_private`) but remains Fixpert-owned and `organization_private`. Vehicle colour may be `public`. A raw camera capture is `mythos_private`. A professional inspection may be `organization_private` or `consent_shared`.

---

### MAD-6 — All MYTHOS_PRIVATE Access is Audit-Logged

**Decision:** Every read or write by a Mythos Super Admin to any `mythos_private` resource across any product is recorded in that product's audit event table and published to the ecosystem audit stream.

**Why:** Super Admin access includes sensitive business intelligence (acquisition prices, customer PII, vehicle movements). Audit logging is the accountability mechanism. Immutability of the audit record is the verification.

**Enforcement:** All `autovaleur_deal_alerts`, `autovaleur_deal_pipeline`, `idauto_vehicle_movements`, `idauto_observation_locations`, and equivalent tables in future products have no API endpoint that does not write an audit event before returning data.

---

### MAD-7 — Provenance Travels with Data

**Decision:** Every datum crossing a product boundary carries its source ID, source type, confidence or trust level, and a point-in-time label if it is a snapshot.

**Why:** AutoValeur's AD-A6 ("no data without a known source") must hold transitively. Without travelling provenance, the origin of a market listing comparison or a parts price estimate is lost at the boundary.

**Enforcement:** Cross-product snapshots include: the originating product, the record ID, the confidence or trust level, and the snapshot timestamp. AutoValeur's `idauto_snapshot_json` column is an example of this pattern.

---

### MAD-8 — Shared Platform Services Defined Once

**Decision:** Services that multiple products consume (authentication, rate limiting, scope enforcement, object storage, search, audit) are defined once in Mythos Core specifications. Products must not implement divergent versions of the same service.

**Current divergences to resolve in MAE-1:**
- Rate limiting: ID Auto has a designed storage model (IP hash, `idauto_verifications`); AutoValeur has a placeholder only. Both must converge to one rate-limit service.
- Audit envelope shape: ID Auto and AutoValeur both have independent audit tables; the common envelope (fields, event taxonomy, retention class) is not yet specified.
- Scope enforcement: currently prose in two architecture documents; must become one shared library specification.

---

## 3. Shared Platform Services

All services below are **target architecture**. They are not all implemented. Implementation order is per the roadmap.

### 3.1 Identity and Access

| Service | Description |
|---------|-------------|
| Authentication | Session tokens, MFA (future), service account credentials |
| Organisation membership | Verified org membership, product entitlements |
| Role-based access | `MYTHOS_SUPER_ADMIN`, product roles, org-scoped roles |
| Service accounts | Machine-to-machine credentials, least privilege |
| Session management | Session creation, revocation, TTL |

### 3.2 Platform Services

| Service | Description |
|---------|-------------|
| API gateway | Routing, rate limiting, auth enforcement, contract versioning |
| Audit | Cross-product append-only event stream, immutable |
| Notifications | In-product and deal alerts, professional subscription alerts |
| Document and object storage | Secure, access-controlled, retention-tagged |
| Media processing | Image resizing, hash deduplication, format conversion |
| Search | Cross-product vehicle and catalogue search |
| Feature flags | Central registry, per-product activation gates |
| Rate limiting | Unified service, one hashing rule (SHA-256 IP + UA) |
| Configuration | Central per-environment, per-product configuration |
| Localisation | Arabic and French, RTL support |
| Billing and subscription | Professional subscriber billing references |
| Support/ticketing | Customer and partner support escalation |

### 3.3 Integration Services

| Service | Description |
|---------|-------------|
| Event bus | Async domain events with envelope standard |
| Transactional outbox | Ensure events are delivered despite partial failures |
| Webhook delivery | Partner and integration webhooks |
| Retry and dead-letter | Failed event handling with observable state |
| Idempotency | Idempotency key enforcement on command APIs |
| Integration monitoring | Contract health, consumer lag, error rates |

### 3.4 Operations

| Service | Description |
|---------|-------------|
| Logs | Centralised, structured, searchable |
| Metrics | Per-product and ecosystem-level |
| Traces | Cross-product request tracing |
| Health checks | Per-product endpoints, dependency checks |
| Backups | Per-product scheduled backup, off-VPS storage |
| Restore testing | Periodic restore in controlled environment |
| Incident alerts | Automated alert on health failure or error rate |
| Deployment history | Release record, commit, environment |

### 3.5 Data Infrastructure

| Layer | Description |
|-------|-------------|
| PostgreSQL | Shared cluster, per-schema product isolation |
| Object storage | Secure, access-controlled (images, documents, media) |
| Search index | Vehicle and product search |
| Analytical warehouse | Future — privacy-safe aggregate analytics |
| Pseudonymised analytics | Aggregate product metrics, no individual tracking |

---

## 4. Infrastructure Target

**Document only — no deployment in MAE-0.**

Long-term target stack:

| Component | Purpose |
|-----------|---------|
| PostgreSQL | Operational data stores |
| Redis or equivalent | Cache, session store, queue (where justified) |
| Object storage | Images, documents, backups |
| API gateway | Routing, rate limiting, auth |
| Event bus / message broker | Async domain events |
| Search service | Vehicle and catalogue search |
| Analytics warehouse | Aggregate intelligence |
| CDN / WAF | Performance and protection |
| Secret manager | Credentials and API keys |
| CI/CD | Automated build, test, deploy |
| Centralised logs | Structured log aggregation |
| Metrics and tracing | Observability |
| Backup storage | Off-VPS, encrypted, versioned |
| Staging environment | Pre-production validation |
| Disaster recovery | Multi-site or cold-standby |

**Environment types:**
- `local` — developer workstation
- `test` — automated CI environment
- `staging` — pre-production, no real data
- `production` — live, monitored, backed up

Production data must not be copied into test or staging without explicit anonymisation. Data-copy procedures require documented authorisation and audit trail.

**Principle:** Prefer the simplest architecture that preserves modular boundaries. Do not select unnecessary technologies for complexity. Add components only when the need is demonstrated.

---

## 5. Repository and Deployment Strategy

### 5.1 Current Repository

`othoth77/mythos-prod` is the source of truth for:
- Mythos OS runtime code and tests
- Architecture documents and roadmaps
- Shared integration contracts
- Product specifications (ID Auto, AutoValeur, automotive umbrella)
- AI handover documentation

### 5.2 Future Repository Policy

Future deployable products may use separate repositories when they require:
- Independent deployment and release cadence
- Different technology stack
- Separate security boundary
- Separate team ownership

Rules for new repositories:
- Named under Mythos namespace: `mythos-{product-name}`
- Must include: CODEOWNERS (when team defined), versioned API specifications, shared schema contracts, release tags, migration scripts, changelogs, handover documents, deprecation notices
- Must be listed in the Mythos Automotive product registry

All repositories remain linked through the Mythos Automotive product registry and this architecture source of truth.

---

## 6. Domain and Endpoint Strategy

### 6.1 Known Domains

| Domain | Product | Status |
|--------|---------|--------|
| `idauto.tn` | ID Auto | Planned |
| `ssangyong.autos` | Parts Network | External, active |

### 6.2 Domain Principles

- One domain per product purpose
- Clear production/staging separation (e.g. `staging.idauto.tn` vs `idauto.tn`)
- TLS required on all endpoints
- Domain ownership documented in a central endpoint catalogue
- Renewal monitoring configured before any domain goes live
- DNS documented and version-controlled
- No hidden admin endpoints without documented purpose
- Central endpoint catalogue updated on each new product activation

### 6.3 AutoValeur Domain

A public domain for AutoValeur is not yet confirmed. Domain selection is deferred to AVA-1 with explicit authorisation.

---

## 7. Security and Privacy Baseline

**Document only — SECURITY-REVIEW-REQUIRED items are catalogued in AUTOMOTIVE_RISK_REGISTER.md.**

### 7.1 Security Principles

| Principle | Description |
|-----------|-------------|
| Least privilege | Every user, role, and service account has the minimum access required |
| MFA | For all privileged users — future target |
| Service account rotation | Scheduled rotation for all service credentials |
| Secret management | No secrets in source code, docs, or commit history |
| Encryption in transit | TLS required on all API and database connections |
| Encryption at rest | Required for sensitive data tiers (PII, financial, MYTHOS_PRIVATE) |
| Object storage controls | Per-object access policy, no public bucket for sensitive assets |
| Audit immutability | Audit event tables are append-only. No UPDATE or DELETE permitted |
| Rate limiting | Enforced at API gateway and application level |
| Abuse detection | Anomalous access patterns trigger alerts |
| Dependency updates | Regular security scanning of dependencies |
| Vulnerability response | Defined response SLA per severity |
| Backup encryption | All backup files encrypted at rest |
| Restore tests | Backups are only valid when restoration is periodically tested |
| Incident response | Documented runbook per product |
| Privileged-access review | Periodic review of `MYTHOS_SUPER_ADMIN` grants |

### 7.2 Privacy Principles

| Principle | Description |
|-----------|-------------|
| Data minimisation | Collect only what is necessary for the stated purpose |
| Privacy classifications | PUBLIC / PROFESSIONAL / MYTHOS_PRIVATE / PRODUCT_INTERNAL / ORG_PRIVATE / CONSENT_SHARED |
| Consent and legal basis | Every data collection has a documented legal basis |
| Retention and deletion | Every data category has a documented retention period |
| Subject rights | Access, correction, consent withdrawal, deletion, restriction workflows |
| Cross-product propagation | Subject right requests propagate to all products holding the subject's data |

### 7.3 Compliance Statement

**Mythos Automotive makes no compliance claims.** All LEGAL-REVIEW-REQUIRED items must be resolved through professional legal counsel. This document does not constitute legal advice and does not claim compliance with any regulation.

**SECURITY-REVIEW-REQUIRED:** A security review is required before any product reaches PILOT status.
