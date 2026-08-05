# Mythos Atelier Network — Architecture

**Stage:** ATN-0 Atelier Network Foundation
**Last updated:** 2026-08-05
**Repository:** othoth77/mythos-prod

---

## 1. Architecture Overview

Mythos Atelier Network is a multi-tenant workshop management platform within the Mythos Automotive portfolio. Its database schema is `atelier_network`. It sits alongside the `idauto`, `autovaleur`, `mythos_core`, and future product schemas in the same shared PostgreSQL cluster.

```
Mythos Automotive Portfolio
│
├── Mythos OS Core (mythos_core schema)
│   Platform services: auth, roles, audit, billing, notifications
│
├── ID Auto (idauto schema)
│   Vehicle identity: fiches, plates, observations, facts, Smart Gate observations
│
├── Atelier Network (atelier_network schema)       ← This product
│   Workshop network: registry, inspections, work orders, AutoCheck
│   Fixpert is the first pilot (external, integration mode TBD)
│
├── Parts Network (parts schema — future)
│   Commerce: parts catalogue, compatibility, suppliers
│
├── AutoValeur (autovaleur schema)
│   Market: valuations, comparables, scores
│
└── [future schemas: automarket, fleet, assistance]
```

**Target DBMS: PostgreSQL** — same shared cluster as all other automotive schemas.
**NOT DEPLOYED in ATN-0.**

---

## 2. Architecture Decisions

### AD-ATN-1 — Multi-Tenant Isolation at Organisation Level

**Decision:** Each workshop organisation is isolated from all other organisations at the data layer. An application credential for organisation A must not be able to read or write organisation B's records.

**Enforcement:**
- All operational records include a `workshop_organization_id` column
- Application layer enforces org-scoped queries — no cross-org join without NETWORK_SUPER_ADMIN credentials
- NETWORK_SUPER_ADMIN access is audit-logged in `atn_audit_events`

---

### AD-ATN-2 — No Global Customer Database

**Decision:** Atelier Network does not maintain a global customer database. Customer PII belongs to each workshop organisation's own tables (within `organization_private` scope). The platform records consent metadata and workshop operation references, not the customer PII itself.

**Why:** Different workshop organisations have different consent frameworks, different data retention obligations, and different customer relationships. Centralising their customer data in the platform would create a data controller aggregation problem without a defined legal basis.

**Enforcement:**
- `atn_appointments.customer_org_ref` is an opaque reference, not a copied PII field
- `atn_work_orders.customer_org_ref` follows the same pattern
- No `customer_name`, `customer_cin`, `customer_phone`, or `customer_email` columns in Atelier Network tables

---

### AD-ATN-3 — Vehicle Identity via ID Auto Only

**Decision:** All work orders and inspections that relate to a specific vehicle must reference `vehicle_id` from ID Auto. Atelier Network does not create competing vehicle records. It does not maintain its own vehicle table.

**Enforcement:**
- `atn_work_orders.vehicle_id_ref` is a cross-schema reference to `idauto.vehicles.vehicle_id`
- No FK constraint across schemas (MAD-4) — application layer integrity
- If a workshop records a vehicle not yet in ID Auto, the resolution path is: Atelier Network submits an ingestion request to ID Auto, not a local vehicle creation

---

### AD-ATN-4 — One Writer Per Business Noun (Atelier Network scope)

**Noun-to-owner table (Atelier Network additions):**

| Noun | Owner |
|------|-------|
| Workshop organisation registry | Atelier Network |
| Workshop registry (workshops, sites) | Atelier Network |
| Network memberships | Atelier Network |
| Integration connectors | Atelier Network |
| Workshop capabilities and accreditations | Atelier Network |
| Service catalogue items | Atelier Network |
| Technician registry | Atelier Network |
| Technician assignments | Atelier Network |
| Appointments (booking metadata) | Atelier Network |
| Inspection provider registry | Atelier Network |
| Inspections and findings | Atelier Network |
| Work orders and interventions | Atelier Network |
| Repair estimates | Atelier Network |
| External workshop records | Atelier Network |
| Smart Gate device registry | Atelier Network |
| Customer consent metadata | Atelier Network |
| Network audit events | Atelier Network |
| Smart Gate observations | ID Auto (not Atelier Network) |
| Customer PII | Each workshop organisation (own tables) |
| Vehicle_id | ID Auto |

---

### AD-ATN-5 — Integration Mode Determines Write Authority

**Decision:** The integration mode of a workshop determines where the authoritative operational records are stored.

| Mode | Authoritative record location |
|------|------------------------------|
| `NATIVE_MANAGED` | Atelier Network `atn_*` tables |
| `EXTERNAL_CONNECTED` | External system; Atelier Network holds summarised reference in `atn_external_workshop_records` |
| `HYBRID` | Divided by function: inspection → Atelier Network; invoicing → external system |

**Enforcement:** A `NATIVE_MANAGED` workshop uses `atn_appointments`, `atn_work_orders` etc. as its authoritative record. An `EXTERNAL_CONNECTED` workshop's records are imported/summarised into `atn_external_workshop_records` — never into the full operational tables as if native.

---

### AD-ATN-6 — Smart Gate Ownership Separation

**Decision:** Each participating workshop owns its Smart Gate device and bears its consent/notice obligation. ID Auto owns the resulting vehicle observation record. Atelier Network owns the device registry (`atn_smart_gate_devices`).

**Enforcement:**
- `atn_smart_gate_devices` records: device identity, workshop site, consent notice status, legal approval status
- Smart Gate RTSP stream ingestion and ANPR processing are governed by ID Auto (IDA-4 scope per workshop)
- `idauto_observations` and `idauto_vehicle_movements` are created by ID Auto, not by Atelier Network
- One workshop cannot access another workshop's Smart Gate events (org-scoped isolation — AD-ATN-1)

---

### AD-ATN-7 — AutoCheck Standard Governance

**Decision:** The AutoCheck inspection protocol is a standard governed by Mythos Atelier Network. Any accredited provider may deliver an AutoCheck inspection. The report carries the accredited provider's name, not the generic "AutoCheck" brand alone.

**Naming rule:**
- `"AutoCheck by Fixpert"` — Fixpert is the first accredited provider
- `"AutoCheck — [Workshop Name]"` — any other accredited partner
- Never: `"Expertise légale certifiée"` (implies legal certification not yet authorised)

**Accreditation:**
- `atn_inspection_providers` records the accreditation of each AutoCheck provider
- `atn_workshop_accreditations` records the formal accreditation certificates
- Accreditation expires — renewal required

---

## 3. Integration Contracts

### 3.1 Atelier Network → ID Auto

| Contract point | Detail |
|----------------|--------|
| Vehicle lookup | Atelier Network reads vehicle_id via ID Auto vehicle lookup API |
| Work order linkage | `atn_work_orders.vehicle_id_ref` references ID Auto vehicle |
| Smart Gate stream | ID Auto ingests RTSP stream and creates observations; Atelier Network registers the device |
| Carte grise OCR routing | Owner PII extracted from carte grise OCR flows to workshop organisation's customer table, never to Atelier Network platform tables |

### 3.2 Atelier Network → AutoValeur

| Contract point | Detail |
|----------------|--------|
| Inspection data | AutoValeur reads repair estimates from Atelier Network API (ATN-1 / AVA-2 scope) |
| AutoValeur stores | `inspection_provider_id`, `repair_estimate_id` as stable references — no customer PII copied |
| AutoValeur display | "Estimation après inspection [Workshop Name]" — not "Expertise légale certifiée" |
| Activation stage | ATN-1 + AVA-2 |

### 3.3 Atelier Network → Mythos Core

| Contract point | Detail |
|----------------|--------|
| Authentication | Mythos Core provides auth tokens for all Atelier Network API calls |
| Organisation registry | Mythos Core `organization_id` is referenced by `atn_workshop_organizations.organization_ref` |
| Audit | Network-level audit events published to Mythos Core audit stream (MAE-3 scope) |
| Billing | Workshop subscription billing managed by Mythos Core billing service |

---

## 4. Domain Events (Design — ATN-0)

No event bus exists in ATN-0. Events are catalogued for future implementation.

| Event | Owner | Privacy class |
|-------|-------|---------------|
| `workshop.registered` | Atelier Network | PROFESSIONAL |
| `workshop.activated` | Atelier Network | PROFESSIONAL |
| `workshop.suspended` | Atelier Network | MYTHOS_PRIVATE |
| `workshop.site.created` | Atelier Network | PROFESSIONAL |
| `inspection_provider.accredited` | Atelier Network | PROFESSIONAL |
| `inspection_provider.revoked` | Atelier Network | PROFESSIONAL |
| `smart_gate.device.registered` | Atelier Network | MYTHOS_PRIVATE |
| `smart_gate.device.activated` | Atelier Network | MYTHOS_PRIVATE |
| `appointment.created` | Atelier Network | ORG_PRIVATE |
| `appointment.confirmed` | Atelier Network | ORG_PRIVATE |
| `vehicle.checked_in` | Atelier Network | ORG_PRIVATE |
| `inspection.started` | Atelier Network | ORG_PRIVATE |
| `inspection.completed` | Atelier Network | ORG_PRIVATE |
| `autocheck.report.issued` | Atelier Network | PROFESSIONAL |
| `work_order.created` | Atelier Network | ORG_PRIVATE |
| `work_order.closed` | Atelier Network | ORG_PRIVATE |
| `repair.estimate.created` | Atelier Network | PROFESSIONAL |
| `intervention.completed` | Atelier Network | ORG_PRIVATE |
| `external_record.received` | Atelier Network | ORG_PRIVATE |

---

## 5. Canonical Identifiers (ATN-0)

New canonical IDs introduced by Atelier Network:

| ID | Owner | Schema | Type | Notes |
|----|-------|--------|------|-------|
| `workshop_organization_id` | Atelier Network | atelier_network | BIGSERIAL | Organisation top-level |
| `workshop_id` | Atelier Network | atelier_network | BIGSERIAL | Workshop brand/location |
| `workshop_site_id` | Atelier Network | atelier_network | BIGSERIAL | Physical site or branch |
| `workshop_capability_id` | Atelier Network | atelier_network | BIGSERIAL | |
| `workshop_accreditation_id` | Atelier Network | atelier_network | BIGSERIAL | |
| `technician_assignment_id` | Atelier Network | atelier_network | BIGSERIAL | |
| `service_catalog_item_id` | Atelier Network | atelier_network | BIGSERIAL | |
| `appointment_id` | Atelier Network | atelier_network | BIGSERIAL | |
| `inspection_id` | Atelier Network | atelier_network | BIGSERIAL | |
| `inspection_provider_id` | Atelier Network | atelier_network | BIGSERIAL | |
| `work_order_id` | Atelier Network | atelier_network | BIGSERIAL | |
| `intervention_id` | Atelier Network | atelier_network | BIGSERIAL | |
| `repair_estimate_id` | Atelier Network | atelier_network | BIGSERIAL | Cross-product: AutoValeur reference |
| `external_workshop_record_id` | Atelier Network | atelier_network | BIGSERIAL | |

`branch_id` is an alias for `workshop_site_id` when the site type is `BRANCH`.

---

## 6. Security and Privacy Baseline

| Rule | Detail |
|------|--------|
| Organisation isolation | No cross-org query without NETWORK_SUPER_ADMIN credentials |
| MYTHOS_PRIVATE always audited | Every super-admin cross-org access is audit-logged |
| No PII in platform tables | Customer PII stays in each organisation's own tables |
| Smart Gate observations are MYTHOS_PRIVATE | ID Auto enforces this; Atelier Network device registry is MYTHOS_PRIVATE |
| Repair estimate access scope | `professional` — visible to AutoValeur; not public |
| Inspection findings access scope | `organization_private` — only the owning org can read detailed findings |
