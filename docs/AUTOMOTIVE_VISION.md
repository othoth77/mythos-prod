# Mythos Automotive — Vision

**Stage:** ATN-0 Atelier Network Foundation and Ecosystem Consistency Amendment (amends MAE-0)
**Last updated:** 2026-08-05
**Repository:** othoth77/mythos-prod

---

## 1. Official Umbrella Identity

**Official name:** Mythos Automotive

**Positioning:**
> Mythos Automotive — La chaîne automobile numérique

**Arabic:**
> ميتوس أوتوموتيف — السلسلة الرقمية المتكاملة للسيارات

Mythos Automotive is not one application. It is the portfolio, governance, and integration layer connecting independent automotive products and businesses in Tunisia.

---

## 2. Mission

**Primary objective:** Build a modular automotive ecosystem covering vehicle identity, inspection, repair, maintenance, spare parts, valuation, verified sales, fleet services, assistance, and future mobility services.

**Core principle:** Each product owns its business domain. Mythos provides platform governance, shared services, integration, and audited administration.

---

## 3. Vehicle-Centric Digital Chain

The ecosystem is organised around the vehicle's complete lifecycle, not around applications. The stable canonical key throughout the chain is `vehicle_id` from ID Auto. No other product creates a competing canonical vehicle identity.

```
Vehicle discovery or registration
        ↓
ID Auto — identity and vehicle fiche
  ├── Plate scan or manual entry
  ├── Observation-first fiche creation
  └── Confidence and verification status
        ↓
AutoValeur — indicative market valuation
  ├── Estimated range (min/max)
  ├── Central market value
  ├── Quick-sale price
  └── Confidence score
        ↓
Atelier Network — AutoCheck inspection (first provider: Fixpert)
  ├── Pre-purchase inspection
  ├── Mechanical and bodywork report
  ├── Diagnostic scan
  └── Risk and suitability assessment
        ↓
Repair and reconditioning plan
  ├── Workshop work order (Atelier Network)
  ├── Parts Network sourcing
  └── Labour and parts estimate
        ↓
Workshop intervention (Atelier Network — first workshop: Fixpert)
  ├── Authorised repairs
  ├── Parts consumed
  └── Quality check
        ↓
AutoValeur — revised valuation post-inspection
  ├── Updated condition grade
  ├── Post-repair market estimate
  └── Margin analysis (professional)
        ↓
AutoMarket Verified — listing
  ├── ID Auto vehicle linkage
  ├── AutoValeur price analysis
  ├── AutoCheck report badge
  └── Verified listing status
        ↓
Offer and completed transaction
  ├── Offer workflow
  ├── Accepted offer
  └── Completed sale confirmation
        ↓
Actual sale result returned to AutoValeur
  ├── Realised price recorded
  ├── Time to sale recorded
  └── Model accuracy feedback loop
        ↓
Future maintenance, assistance and fleet lifecycle
  ├── Fleet Pro management
  ├── Fixpert Assistance
  └── EV / Hybrid Center
```

---

## 4. Core Design Principles

### 4.1 Vehicle-Centric

The ecosystem is vehicle-centric, not application-centric. A vehicle's complete history across inspections, valuations, listings, and sales must be traceable through a single canonical `vehicle_id` from ID Auto.

### 4.2 Product Autonomy

Each product owns its business domain. Product ownership means:
- The product is the sole writer of its own operational tables.
- The product sets its own access and privacy rules within ecosystem constraints.
- The product is responsible for its own data quality.
- Other products consume the product's data through authorised APIs or events.

### 4.3 Platform Governance

Mythos provides platform services without becoming a copy of every product's data. Mythos Core stores stable references, permissions, integrations, and audit. It does not duplicate invoices, listings, observations, or valuations.

### 4.4 Privacy by Design

Privacy constraints are enforced at the schema level where possible:
- No owner PII in vehicle identity tables (AD-2 from IDA-1)
- No customer PII in valuation tables (AD-A5 from AVA-0)
- Separate tables for sensitive data (observation locations, camera events)
- Three access scopes enforced at the API boundary

### 4.5 Legal First

No data collection, marketplace integration, camera connection, or automated analysis begins without the relevant LEGAL-REVIEW-REQUIRED item being explicitly resolved. Legal review is tracked as structured data, not prose notes.

### 4.6 Immutable Evidence

Raw observations, valuations, and audit events are immutable. Corrections are additive (new records, versioned facts). Nothing significant is silently overwritten.

### 4.7 One Major Implementation Stage at a Time

Only one major implementation stage is active at a time unless explicitly authorised otherwise. Documentation stages may prepare future tracks without activating them.

---

## 5. Current Market Context

**Geographic scope:** Tunisia, focusing on the used-vehicle market.

**Target segments:**
- General public seeking vehicle valuations and verified listings
- Professional vehicle traders and dealers
- Independent workshops and repair garages (via Atelier Network — first pilot: Fixpert)
- Insurance companies
- Fleet management operators
- Future: finance, assistance, and mobility partners

**Competitive positioning:** No integrated vehicle identity + inspection + valuation + verified marketplace chain currently exists in the Tunisian market. Mythos Automotive's advantage is the data flywheel: each vehicle journey through the chain enriches the data available for valuation accuracy and market intelligence.

---

## 6. Regulatory Environment

Tunisia's automotive sector is subject to:

- Organic law 63-2004 (personal data protection)
- INPDP — Institut National de Protection des Données Personnelles
- Traffic authority regulations (ATTT or equivalent) for plate data
- Commercial and consumer protection laws for marketplace transactions
- Professional liability for inspection reports used in financial decisions

All LEGAL-REVIEW-REQUIRED items in this repository must be resolved through professional legal counsel before the relevant features activate. This document does not constitute legal advice.

---

## 7. What Mythos Automotive Is Not

- **Not a surveillance system.** Vehicle movement data is MYTHOS_PRIVATE, never a public product.
- **Not a single monolithic application.** Each product deploys and releases independently.
- **Not a data broker.** Aggregated market intelligence is authorised and privacy-safe. Raw personal vehicle movement is never sold or shared.
- **Not a legal valuation service.** All estimates are market estimates, not certified expertise.
- **Not an automated purchasing system.** Deal Radar requires human review before any acquisition action.
