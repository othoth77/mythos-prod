# Mythos Atelier Network — Roadmap

**Product:** Atelier Network
**Platform:** Mythos ecosystem
**Last updated:** 2026-08-05

---

## Stage Overview

| Stage | Name | Status |
|-------|------|--------|
| ATN-0 | Foundation — product spec, architecture, schema draft, AutoCheck standard | ✓ Done (2026-08-05) |
| ATN-1 | Core API, Workshop Registry and First Integration | Planned (blocked on IDA-2) |
| ATN-2 | Inspection API and AutoCheck Launch | Planned (blocked on ATN-1) |
| ATN-3 | External Connected Mode and Partner Network | Planned (blocked on ATN-2) |
| ATN-4 | Smart Gate Network and AutoCheck Scale | Planned (blocked on ATN-3 + legal) |
| ATN-5 | Network Intelligence and Fleet Services | Future |

---

## ATN-0 — Foundation ✓ Done

**Completed:** 2026-08-05

**Scope:**
- Atelier Network product specification (this document family)
- Multi-workshop architecture definition: workshop types, integration modes, multi-tenant hierarchy
- AutoCheck standard specification (provider-neutral)
- Atelier Network architecture decisions (AD-ATN-1 through AD-ATN-7)
- Draft PostgreSQL schema: 24 tables (`atn_` prefix, `atelier_network` schema, NOT DEPLOYED)
- Configuration draft: `atelier-network.example.json`
- Roles defined: NETWORK_SUPER_ADMIN, ORGANIZATION_OWNER, WORKSHOP_MANAGER, SERVICE_ADVISOR, TECHNICIAN, INSPECTOR, CASHIER, READ_ONLY_AUDITOR, API_SERVICE_ACCOUNT
- Ecosystem corrections:
  - Fixpert repositioned as first workshop pilot (not the entire workshop domain)
  - AutoCheck standard generalised to any accredited provider
  - Smart Gate generalised to any participating workshop (IDA-4 Fixpert pilot preserved)
  - Atelier Network established as Core Pillar B in the portfolio
  - Roadmap and dependency corrections: MAE-0 → COMPLETE; IDA-1 spec-only; AVA-2 → ATN-1; IDA-4 → ATN-1 + legal
- New integration contracts: 6 generic Atelier Network contracts documented
- New domain events: 19 workshop-related events designed

**Scope exclusions (ATN-0):**
- No workshop onboarded
- No API built or deployed
- No PostgreSQL installed or deployed
- No real workshop, customer, or vehicle data ingested
- No Smart Gate cameras connected
- No Fixpert system modified
- All feature flags: false

---

## ATN-1 — Core API, Workshop Registry and First Integration

**Status:** Planned
**Depends on:** IDA-2 complete (PostgreSQL cluster available)
**Parallel with:** IDA-3, AVA-1

**Objective:** Deploy the Atelier Network platform schema, launch the workshop registry API, and establish the first integration with a participating workshop. Define the Fixpert connector as the first EXTERNAL_CONNECTED pilot.

**Scope:**
- `atelier_network` schema deployed (core tables: organisations, workshops, sites, capabilities, accreditations, connectors)
- Workshop registry API: CRUD for organisations, workshops, sites
- Network membership management
- Fixpert onboarding specification as first EXTERNAL_CONNECTED workshop (integration mode: TBD, API contract: TBD)
- AutoCheck accreditation registry (inspection_providers, accreditations)
- Service catalogue API (basic)
- Technician registry and assignment API
- Mythos Core auth integration (roles, organisation membership)
- NATIVE_MANAGED appointment and work order API (alpha)
- Repair estimate API endpoint (consumed by AutoValeur in AVA-2)
- Audit logging for NETWORK_SUPER_ADMIN access
- 50+ automated tests

**Exclusions from ATN-1:**
- Smart Gate device activation (requires ANPR legal approval per workshop — ATN-4)
- AutoCheck report publication to AutoMarket (ATN-2)
- External Connected full sync (ATN-3)
- Fleet services (ATN-5)

**Legal review required before ATN-1:**
- AutoCheck inspection liability wording (R-L06)
- Workshop onboarding legal agreement template
- Data processing agreement per organisation
- Cross-product inspection data sharing basis (ATN → AutoValeur)

---

## ATN-2 — Inspection API and AutoCheck Launch

**Status:** Planned
**Depends on:** ATN-1 complete

**Objective:** Launch the AutoCheck inspection API and issue the first AutoCheck report. Activate the repair estimate integration with AutoValeur.

**Scope:**
- AutoCheck inspection workflow: appointments → check-in → inspection items → findings → report
- AutoCheck report generation (PDF and structured output)
- Inspection provider accreditation enforcement
- Repair estimate publication to AutoValeur API endpoint
- Report brand name enforcement: "AutoCheck by [Provider Name]"
- Inspection history read for professional subscribers (vehicle_id-based)
- Smart Gate observation event linkage (workshop check-in triggered by Smart Gate — ID Auto side)
- AutoMarket inspection badge integration (structural, pending AutoMarket specification)
- 50+ automated tests

**Legal review required before ATN-2:**
- Inspection report liability wording confirmed (R-L06 must be resolved)
- AutoCheck provider agreement signed per workshop

---

## ATN-3 — External Connected Mode and Partner Network

**Status:** Planned
**Depends on:** ATN-2 complete

**Objective:** Open the EXTERNAL_CONNECTED integration mode to partner workshops. A workshop with its own existing software can connect via API to receive vehicle_id linkage, AutoCheck reporting, and inspection history.

**Scope:**
- EXTERNAL_CONNECTED API: receives inspection results, work order summaries, vehicle_id lookups
- `atn_external_workshop_records` pipeline: normalise and map incoming records
- Partner workshop onboarding flow (automated + manual verification)
- Webhook delivery for workshop events
- Integration health monitoring
- API key management for `API_SERVICE_ACCOUNT` role
- HYBRID mode support: inspection native + invoicing external
- Partner network dashboard (PROFESSIONAL scope)
- 50+ automated tests

---

## ATN-4 — Smart Gate Network and AutoCheck Scale

**Status:** Planned
**Depends on:** ATN-3 complete; legal: ANPR approval per workshop; IDA-4 complete (first Fixpert Smart Gate pilot)

**Objective:** Extend Smart Gate to additional participating workshops. Scale AutoCheck to a broader accredited provider network.

**Scope:**
- Smart Gate device onboarding workflow for additional workshops
- ANPR approval tracking per device (`atn_smart_gate_devices.anpr_approval_ref`)
- Consent notice compliance verification per workshop site
- Smart Gate device health monitoring
- AutoCheck accreditation renewal workflow
- Multi-provider AutoCheck report management
- Network-level AutoCheck statistics (PROFESSIONAL scope — no individual data)
- 50+ automated tests

**Legal review required before ATN-4:**
- ANPR regulatory approval per new workshop (one approval per workshop — not transferable from Fixpert pilot)
- Camera disclosure and consent notice verification per site

---

## ATN-5 — Network Intelligence and Fleet Services

**Status:** Future
**Depends on:** ATN-4 complete; Fleet Pro specification

**Objective:** Provide network-level aggregate intelligence and connect to the Fleet Pro product.

**Scope:**
- Network aggregate dashboards (PROFESSIONAL scope): inspection volumes, service category distribution, regional coverage
- Fleet Pro integration: vehicle_id-linked maintenance records, fleet service history
- Predictive maintenance indicators (aggregate, not individual surveillance)
- Multi-workshop fleet service contracts
- Parts Network integration: parts usage tracking and availability forecasting
- AutoCheck history as a product feature: professional subscribers access inspection history by vehicle_id

---

## Dependency Map

```
IDA-2 (PostgreSQL cluster)
    └──► ATN-1 (Workshop Registry + First Integration)
              └──► ATN-2 (Inspection API + AutoCheck)
                        └──► ATN-3 (External Connected + Partner Network)
                                  └──► ATN-4 (Smart Gate Network, legal required)
                                            └──► ATN-5 (Network Intelligence + Fleet)

ATN-1 (inspection API) enables:
    └──► AVA-2 (AutoValeur post-inspection valuation)

IDA-4 (Fixpert Smart Gate pilot, IDA-3 + legal required)
    └──► ATN-4 (general Smart Gate network expansion)
```

---

## Cross-Product Dependencies

| ATN Stage | Enables / Requires |
|-----------|-------------------|
| ATN-1 | Requires: IDA-2 (PostgreSQL). Enables: AVA-2 start (repair estimate API) |
| ATN-2 | Enables: AutoMarket inspection badge |
| ATN-4 | Requires: IDA-4 complete (first Smart Gate pilot); legal clearance per workshop |
| ATN-5 | Requires: Fleet Pro specification |

---

## LEGAL-REVIEW-REQUIRED (open items)

| Item | Blocking stage |
|------|---------------|
| AutoCheck inspection liability wording (R-L06) | ATN-1 / ATN-2 |
| Workshop onboarding agreement template | ATN-1 |
| Data processing agreement per workshop organisation | ATN-1 |
| Cross-product inspection data sharing basis (ATN → AutoValeur) | ATN-1 |
| ANPR regulatory approval per workshop (generalisation of R-L02) | ATN-4 per workshop |
| Smart Gate consent notice requirements per site | ATN-4 per site |
| AutoCheck accreditation legal status | ATN-2 |
