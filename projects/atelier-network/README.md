# Mythos Atelier Network

**Product key:** `atelier_network`
**Schema:** `atelier_network`
**Positioning:** Multi-workshop platform — the professional repair, maintenance and inspection network of the Mythos Automotive ecosystem
**Platform:** Mythos ecosystem
**Repository:** othoth77/mythos-prod (`projects/atelier-network/`, `docs/ATELIER_NETWORK_*.md`)
**Current stage:** ATN-0 — Atelier Network Foundation (2026-08-05)
**Status:** Foundation documentation stage — no deployment, no real data

---

## Purpose

Mythos Atelier Network is the generic multi-workshop management platform within the Mythos Automotive ecosystem. It provides the governance, registry, integration layer, and operational API for vehicle repair, inspection, maintenance, and workshop services — across any participating workshop, regardless of size or ownership model.

**Fixpert is the first workshop pilot.** Fixpert's existing external operational system predates the Atelier Network platform. Integration mode for Fixpert is to be confirmed in ATN-1. No other workshop is currently onboarded.

---

## Core Responsibilities

| Domain | Owner |
|--------|-------|
| Workshop registry (organisations, sites, capabilities) | Atelier Network |
| Network membership and governance | Atelier Network |
| Service catalogue (generic, per-workshop) | Atelier Network |
| Inspection provider accreditation | Atelier Network |
| AutoCheck standard governance | Atelier Network |
| Integration connectors (NATIVE / EXTERNAL / HYBRID) | Atelier Network |
| Smart Gate device registry | Atelier Network |
| Network-level audit events | Atelier Network |
| Workshop operational data (appointments, work orders, invoices) | Each workshop organisation |
| Customer and client PII | Each workshop organisation |
| Smart Gate observations | ID Auto (not Atelier Network) |

---

## Workshop Types

| Type | Description |
|------|-------------|
| `OWNED` | Directly owned and operated by the network |
| `BRANCH` | Branch of a multi-site workshop organisation |
| `FRANCHISE` | Franchised under network operating standards |
| `PARTNER` | Independent partner connected via agreement |
| `AUTHORIZED_INSPECTION` | Authorised inspection-only provider (AutoCheck) |
| `MOBILE_SERVICE` | Mobile service without fixed premises |

---

## Integration Modes

| Mode | Description |
|------|-------------|
| `NATIVE_MANAGED` | Workshop uses Atelier Network platform natively |
| `EXTERNAL_CONNECTED` | Workshop keeps its own software; connects via API |
| `HYBRID` | Uses platform for some functions, external for others |

---

## Multi-Tenant Hierarchy

```
workshop_organization_id
    └── workshop_id (brand or location)
            └── workshop_site_id / branch_id
                    └── Operational records (appointments, work orders, inspections)
```

Each level has its own access boundary. One workshop organisation cannot access another's operational data.

---

## AutoCheck Standard

AutoCheck is the provider-neutral pre-purchase inspection and vehicle condition report standard, governed by Mythos Automotive / Atelier Network.

- **"AutoCheck by Fixpert"** — when Fixpert performs the inspection
- **"AutoCheck — [Workshop Name]"** — when any other authorised provider performs it
- **Never:** "Expertise légale certifiée" (unless future legal authorisation is obtained)

See `docs/AUTOCHECK_STANDARD.md` for the full protocol.

---

## Data Status

**No real data is ingested in ATN-0.**

- No PostgreSQL installed or deployed
- No services deployed
- No workshop onboarded
- No inspection data
- All feature flags: `false`

---

## Repository Layout

```
projects/atelier-network/
├── README.md                                  ← this file
├── config/
│   └── atelier-network.example.json           ← configuration draft (ATN-0)
└── database/
    └── schema.sql                             ← atelier_network schema draft (not deployed)

docs/
├── ATELIER_NETWORK_PRODUCT_SPEC.md            ← product vision, roles, workshop types, integration modes
├── ATELIER_NETWORK_ARCHITECTURE.md            ← architecture decisions, multi-tenant model, Smart Gate
├── ATELIER_NETWORK_ROADMAP.md                 ← ATN-0 through ATN-5 stage plan
└── AUTOCHECK_STANDARD.md                      ← AutoCheck inspection protocol and report standard
```

---

## Next Stage

**ATN-1 — Core API, Workshop Registry and First Integration** (future, not authorised now)

Before ATN-1: IDA-2 must provision and prove the shared PostgreSQL cluster. ATN-1 runs in parallel with IDA-3 and AVA-1.
