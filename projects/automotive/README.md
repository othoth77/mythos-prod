# Mythos Automotive

**Umbrella name:** Mythos Automotive
**Positioning:** Mythos Automotive — La chaîne automobile numérique
**Arabic:** ميتوس أوتوموتيف — السلسلة الرقمية المتكاملة للسيارات
**Platform:** Mythos ecosystem
**Repository:** othoth77/mythos-prod (`projects/automotive/`, `docs/AUTOMOTIVE_*.md`)
**Current stage:** MAE-0 — Ecosystem Master Foundation (2026-08-05)
**Status:** Master documentation and governance stage — no deployment, no real data

---

## Purpose

Mythos Automotive is not one application. It is the portfolio, governance, and integration layer connecting independent automotive products and businesses.

**Primary objective:** Build a modular automotive ecosystem covering vehicle identity, inspection, repair, maintenance, spare parts, valuation, verified sales, fleet services, assistance, and future mobility services — for the Tunisian market.

**Core principle:** Each product owns its business domain. Mythos provides platform governance, shared services, integration, and audited administration.

---

## Vehicle-Centric Digital Chain

```
Vehicle discovery or registration
        ↓
ID Auto identity and vehicle fiche
        ↓
AutoValeur indicative valuation
        ↓
AutoCheck / Fixpert inspection
        ↓
Repair and reconditioning plan
        ↓
Parts Network sourcing
        ↓
Fixpert intervention
        ↓
AutoValeur revised valuation
        ↓
AutoMarket Verified listing
        ↓
Offer and completed transaction
        ↓
Actual sale result returned to AutoValeur
        ↓
Future maintenance, assistance and fleet lifecycle
```

The ecosystem is **vehicle-centric, not application-centric.** The stable canonical key is `vehicle_id` from ID Auto. No other product creates a competing canonical vehicle identity.

---

## Current Product Portfolio

### Core Four Pillars

| Product | Domain | Stage |
|---------|--------|-------|
| Mythos OS | Platform, shared services, administration | In production (Stage 4 extraction) |
| ID Auto | Vehicle identity, observations, verified facts | IDA-1 complete, IDA-2 next |
| Fixpert Atelier | Repair, inspection, workshop management | External, integration specified |
| Parts Network (ssangyong.autos) | Spare parts, catalogue, stock, e-commerce | External, future integration |
| AutoValeur | Vehicle valuation, market intelligence | AVA-0 complete, AVA-1 next |

### Near-Term Planned Products

| Product | Domain | Status |
|---------|--------|--------|
| AutoCheck by Fixpert | Pre-purchase inspection report, risk and repair estimate | CONCEPT |
| AutoMarket Verified | General marketplace, ID Auto-linked, verified listings | CONCEPT |

### Future Products

| Product | Domain | Status |
|---------|--------|--------|
| Fleet Pro | Professional fleet management, cost, valuation | CONCEPT |
| Fixpert Assistance | Roadside assistance, towing, incident management | CONCEPT |
| EV & Hybrid Center | Battery health, EV diagnostics, specialised parts | CONCEPT |

---

## Ownership Boundaries

| Product | Owns |
|---------|------|
| Mythos OS core | Platform users, organisations, global roles, audit, integrations |
| ID Auto | Canonical vehicle_id, plates, observations, verified facts, vehicle taxonomy |
| Fixpert | Customers, appointments, inspections, work orders, invoices, payments |
| Parts Network | Part catalogue, part_id, compatibility, suppliers, stock, orders |
| AutoValeur | Valuations, comparables, market snapshots, liquidity/opportunity scores |
| AutoMarket | Listings, leads, offers, completed transaction records |
| Fleet | Fleet membership, fleet policy, cost dashboards |
| Assistance | Assistance cases, dispatch, towing/service records |

No product duplicates another product's operational records. Mythos Core stores stable references, permissions, integrations, and audit — not business domain data.

---

## Repository Layout

```
projects/automotive/
├── README.md                                  ← this file
├── config/
│   └── automotive.example.json                ← configuration draft (MAE-0)
└── database/
    └── control-plane-schema.sql               ← control-plane draft (PostgreSQL, not deployed)

docs/
├── AUTOMOTIVE_VISION.md                       ← umbrella vision and positioning
├── AUTOMOTIVE_PRODUCT_PORTFOLIO.md            ← full product portfolio specification
├── AUTOMOTIVE_ARCHITECTURE.md                 ← master architecture decisions
├── AUTOMOTIVE_INTEGRATION_CONTRACTS.md        ← integration principles and event catalogue
├── AUTOMOTIVE_DATA_GOVERNANCE.md              ← ownership matrix, canonical IDs, PII
├── AUTOMOTIVE_OPERATING_MODEL.md              ← responsibilities, RACI, stage gates
├── AUTOMOTIVE_KPI_MODEL.md                    ← KPI tree and unit economics
├── AUTOMOTIVE_RISK_REGISTER.md                ← portfolio risk register
└── AUTOMOTIVE_ROADMAP.md                      ← MAE-0 through MAE-6 stage plan
```

---

## Data Status

**No real data is ingested in MAE-0.**

- No PostgreSQL installed
- No services deployed
- No marketplace data
- No real vehicle listings
- No customer data
- All feature flags: `false`

---

## Next Stage

**MAE-1 — Control Plane and Shared Contract Specification** (future, not authorised now)

Before MAE-1: IDA-2 must provision and prove the shared PostgreSQL cluster.
