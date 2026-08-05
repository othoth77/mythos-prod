# Mythos Atelier Network — Product Specification

**Stage:** ATN-0 Atelier Network Foundation
**Last updated:** 2026-08-05
**Product key:** `atelier_network`
**Platform:** Mythos ecosystem
**Repository:** othoth77/mythos-prod (`projects/atelier-network/`, `docs/ATELIER_NETWORK_*.md`)

---

## 1. Product Vision

Mythos Atelier Network is the generic multi-workshop platform within the Mythos Automotive ecosystem. Its objective is to provide a governed, privacy-respecting, and modular network for vehicle repair workshops, inspection centres, and maintenance service providers — of any size, ownership model, or software maturity — operating in Tunisia.

The platform provides:
- A workshop registry with multi-tenant isolation
- An inspection and AutoCheck standard (provider-neutral)
- Integration connectors for workshops at any level of digital maturity
- A canonical link between workshop operations and the vehicle identity layer (ID Auto)
- Governance over the AutoCheck inspection standard

**Fixpert is the first workshop pilot.** Fixpert is an existing external operational system that predates the Atelier Network platform. Future integration between Fixpert and the Atelier Network platform will be specified in ATN-1. Fixpert's existing business logic, invoicing, customer records, and operations are not managed by this repository.

---

## 2. Market Context

Tunisian vehicle repair workshops range from fully informal operations to multi-site specialised centres. Most have limited or no digital tooling. A platform that serves this range must support both native management (workshop uses Atelier Network as its digital backbone) and external connection (workshop connects its existing software via API).

The Atelier Network is not a CRM, accounting system, or ERP. It is the integration layer that connects workshop operations to the Mythos Automotive digital chain.

---

## 3. User Groups

### 3.1 Network Super Admin

Mythos platform administrators with cross-organisation read access, accreditation management, and governance oversight. Every access to organisation-private data is audit-logged.

### 3.2 Organisation Owner

The legal owner or delegate of a workshop organisation. Full access within their own organisation. Cannot access other organisations' data.

### 3.3 Workshop Manager

Operational manager of a single workshop site. Manages staff assignments, appointments, work orders, and reports for their site only.

### 3.4 Service Advisor

Front-of-house staff. Creates and manages appointments and work orders. Does not have access to financial reporting.

### 3.5 Technician

Access to work orders and interventions assigned to them. Cannot access other technicians' work orders or financial data.

### 3.6 Inspector

Certified to perform AutoCheck inspections. Creates inspection records, items, and findings. Read-only access to relevant work orders.

### 3.7 Cashier

Invoice and payment management within one workshop. No access to inspection or repair technical details.

### 3.8 Read-Only Auditor

Read-only access across one organisation for audit or compliance review purposes.

### 3.9 API Service Account

Machine-to-machine credential for EXTERNAL_CONNECTED workshops that integrate their own systems with the Atelier Network API.

---

## 4. Workshop Types

| Type | Description |
|------|-------------|
| `OWNED` | Directly owned and operated by the network organisation |
| `BRANCH` | Branch site of a multi-location workshop brand |
| `FRANCHISE` | Independently owned but operating under network standards |
| `PARTNER` | Independent workshop connected through a formal agreement |
| `AUTHORIZED_INSPECTION` | Provides AutoCheck inspection only; no full repair operations |
| `MOBILE_SERVICE` | Mobile service unit without fixed premises |

---

## 5. Integration Modes

Atelier Network supports three integration modes to accommodate workshops at different levels of digital maturity:

| Mode | Description |
|------|-------------|
| `NATIVE_MANAGED` | Workshop uses Atelier Network platform natively for all operations. Appointments, work orders, inspections, and reporting are all managed through the Atelier Network API or UI. |
| `EXTERNAL_CONNECTED` | Workshop retains its existing software. Connects to Atelier Network via API for data exchange: inspection results, vehicle_id linkage, AutoCheck reports. No migration of existing data required. |
| `HYBRID` | Uses Atelier Network natively for some functions (e.g. AutoCheck inspection reporting) while retaining its own software for others (e.g. invoicing). |

**Fixpert integration mode is TBD — to be confirmed in ATN-1.**

---

## 6. Multi-Tenant Architecture

The multi-tenant hierarchy ensures strict data isolation between organisations:

```
workshop_organization_id (legal entity / brand)
    └── workshop_id (individual workshop brand or location)
            └── workshop_site_id (physical site or branch)
                    └── Operational records
                        (appointments, work orders, inspections, interventions)
```

**Isolation rules:**
- One organisation cannot access another organisation's data
- Within an organisation, a workshop manager can access only their own site's data
- NETWORK_SUPER_ADMIN can access across organisations for audit purposes, with full audit logging
- No global customer database exists — customer PII belongs to each organisation's own tables

---

## 7. Data Ownership Boundaries

### 7.1 What Atelier Network Owns

| Data entity | Owner |
|-------------|-------|
| Workshop organisation registry | Atelier Network |
| Workshop registry (brands, sites) | Atelier Network |
| Network membership records | Atelier Network |
| Integration connector registry | Atelier Network |
| Workshop capabilities and accreditations | Atelier Network |
| Service catalogue (generic metadata) | Atelier Network |
| Inspector and technician registry | Atelier Network |
| AutoCheck standard governance and accreditation | Atelier Network |
| Inspection provider registry | Atelier Network |
| Smart Gate device registry | Atelier Network |
| Network-level audit events | Atelier Network |
| Repair estimate records (inspection output) | Atelier Network |

### 7.2 What Each Workshop Organisation Owns

| Data entity | Owner |
|-------------|-------|
| Customer records and PII | Workshop organisation |
| Customer consent records | Workshop organisation |
| Appointment business data (customer-linked) | Workshop organisation |
| Work order financial totals and invoices | Workshop organisation |
| Payment records | Workshop organisation |
| Staff personal records | Workshop organisation |

### 7.3 What ID Auto Owns

| Data entity | Owner |
|-------------|-------|
| Vehicle_id (canonical) | ID Auto |
| Smart Gate observations (once ingested) | ID Auto |
| Vehicle movements (MYTHOS_PRIVATE) | ID Auto |

### 7.4 Cross-Product References

- Work orders and inspections reference `vehicle_id` from ID Auto (no FK — application layer integrity)
- Repair estimates are consumed by AutoValeur for post-inspection valuation
- AutoValeur stores `inspection_provider_id` + `repair_estimate_id` as a stable reference — it does not copy customer data or intervention details

---

## 8. AutoCheck Standard

AutoCheck is the provider-neutral vehicle inspection protocol and report standard, governed by Mythos Atelier Network.

**Naming rules:**
- `"AutoCheck by Fixpert"` — when Fixpert performs the inspection (Fixpert is the first accredited provider)
- `"AutoCheck — [Workshop Name]"` — when any other accredited partner performs the inspection
- **Never:** `"Expertise légale certifiée"` — this wording implies legal certification that requires professional indemnity insurance and specific regulatory authorisation not yet obtained

See `docs/AUTOCHECK_STANDARD.md` for the full protocol.

---

## 9. Smart Gate Generalisation

Smart Gate camera observation is a generic capability that any participating workshop may use, subject to legal approvals and accreditation.

**Ownership rules:**
- Each participating workshop owns its physical camera device and bears the consent/notice obligation toward vehicles and their drivers/owners
- ID Auto owns the resulting vehicle observation record
- One workshop cannot access another workshop's Smart Gate events
- All Smart Gate observations are `MYTHOS_PRIVATE` — Mythos Super Admin access only, all access audit-logged

**IDA-4 scope:** The first Smart Gate pilot is specifically Fixpert. This scope (one camera, one entrance/exit) is preserved and does not change with the introduction of the Atelier Network. Future Smart Gate rollout to other workshops is governed by ATN stage milestones and requires the same legal approvals as IDA-4.

---

## 10. Access Model

| Scope | Who | Example data |
|-------|-----|-------------|
| `public` | Any caller | Workshop name, location, service categories |
| `professional` | Verified subscriber | Inspection summary, service history count |
| `mythos_private` | Mythos Super Admin only (audit-logged) | Cross-org audit events, smart gate device registry |
| `product_internal` | Atelier Network API only | Integration connector credentials |
| `organization_private` | One workshop organisation | Appointments, work orders, customer data |
| `consent_shared` | Subject-consented cross-product | Customer PII routed to ID Auto with consent |

---

## 11. Legal Review Required

All items are OPEN in ATN-0.

| Item | Blocking stage |
|------|---------------|
| Smart Gate ANPR regulatory approval for each new workshop | ATN-1 / IDA-4 per workshop |
| Consent notice requirements for Smart Gate per workshop site | ATN-1 per workshop |
| AutoCheck inspection liability wording and professional indemnity | ATN-1 (AutoCheck API) |
| Workshop onboarding legal agreement template | ATN-1 |
| Data processing agreement per organisation | ATN-1 |
| Cross-product inspection data sharing basis (Atelier Network → AutoValeur) | ATN-1 / AVA-2 |

---

## 12. Scope Exclusions (ATN-0)

- No workshop onboarded
- No API built or deployed
- No PostgreSQL installed or deployed
- No real workshop, customer, or vehicle data ingested
- No Smart Gate cameras connected
- No AutoCheck report generated
- No invoicing or payment processing
- All feature flags: `false`
- Do not modify the existing external Fixpert system
