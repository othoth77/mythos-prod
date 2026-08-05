# AutoValeur — Product Roadmap

**Product:** AutoValeur
**Platform:** Mythos ecosystem
**Last updated:** 2026-08-05

---

## Stage Overview

| Stage | Name | Status |
|-------|------|--------|
| AVA-0 | Foundation and Ecosystem Roadmap | ✓ Done |
| AVA-1 | Public Calculator MVP | Planned |
| AVA-2 | Professional Tier and Atelier Network Integration | Planned |
| AVA-3 | Market Data Foundation | Planned |
| AVA-4 | Deal Radar MVP | Planned |
| AVA-5 | Marketplace Integration and Completed Sales | Future |
| AVA-6 | Model Maturity and Ecosystem Expansion | Future |

---

## AVA-0 — Foundation and Ecosystem Roadmap ✓ Done

**Completed:** 2026-08-05

**Scope:**
- Product identity, tagline, public promise
- Ecosystem position: product tree, ownership boundaries
- Three product versions defined: Public, Pro, Intelligence
- Valuation output definition (17 fields, range-not-single-number invariant)
- Valuation factors (vehicle identity, condition, market, economic)
- Comparable engine design (selection criteria, quality rules, initial approach)
- Liquidity score design (7 factors, 5 classes)
- Repair/reconditioning cost pipeline design
- Opportunity score design (8 dimensions, 5 classes)
- Mythos Deal Radar pipeline design (10 steps, 11 states, human review required)
- Fixpert integration levels (indicative vs post-inspection)
- Model governance design (version increment triggers, evaluation metrics)
- Manipulation and fraud resistance design (11 protections)
- Access and privacy (3 scopes, public output restrictions)
- Business model (public, professional, ecosystem revenue)
- LEGAL-REVIEW-REQUIRED catalogue (17 items)
- Architecture decisions AD-A1 through AD-A8
- Integration contracts (ID Auto, Fixpert, parts platforms, marketplace, Mythos OS)
- Draft PostgreSQL schema (18 tables, autovaleur schema, NOT INSTALLED)
- Configuration draft (autovaleur.example.json)

**Scope exclusions (AVA-0):**
- No valuation calculator implemented
- No API built
- No PostgreSQL installed or deployed
- No real vehicle listing data ingested
- No marketplace scraping
- No deal radar activated
- No Fixpert integration built
- No Mythos OS integration built
- All feature flags: false

---

## AVA-1 — Public Calculator MVP

**Prerequisites:**
- AVA-0 complete ✓
- IDA-2 complete (PostgreSQL cluster provisioned and idauto schema deployed)
- Legal review: LEGAL-REVIEW-REQUIRED items blocking AVA-1 resolved (see table below)

**Scope:**
- PostgreSQL `autovaleur` schema deployed (core tables only: valuations, model_versions, source_catalogue, comparables, condition_reports, audit_events)
- Manual vehicle entry form (make, model, year, fuel, mileage, declared condition)
- Transparent rule-based valuation engine (comparable weighting, depreciation, confidence)
- Synthetic and authorised market dataset (no real marketplace scraping)
- Public outputs: estimated range, central value, quick-sale price, confidence score, comparable summary
- Clear disclaimer on every output: "Estimation uniquement, pas une expertise légale certifiée"
- Save valuation record (immutable)
- Rate limiting for anonymous callers
- Mythos OS authentication integration (for future professional tier)
- No Deal Radar
- No marketplace ingestion
- No Fixpert integration

**Not in AVA-1:**
- Professional tier (AVA-2)
- Real marketplace data (AVA-3)
- Deal Radar (AVA-4)

---

## AVA-2 — Professional Tier and Atelier Network Integration

**Prerequisites:**
- AVA-1 complete
- ATN-1 complete (Atelier Network inspection API and repair estimate endpoint available)
- Legal review: Atelier Network repair data reuse for valuation, professional subscriber data handling

**Scope:**
- Professional subscriber authentication (Mythos OS roles)
- Professional valuation outputs: professional purchase price, resale price, margin analysis, expected resale period
- Atelier Network inspection integration: read repair estimate from ATN API (`inspection_provider_id`, `repair_estimate_id`), assemble reconditioning estimate
- Parts price lookup: ssangyong.autos integration (authorised data feed)
- Repair estimate tables deployed (autovaleur_repair_estimates, autovaleur_repair_estimate_lines, autovaleur_parts_quotes)
- Post-inspection valuation with updated confidence score
- Professional bulk fleet valuation (batch mode)
- Professional API access (authenticated)
- Valuation reports (PDF export)
- Price alert subscriptions

**Not in AVA-2:**
- Real marketplace listing data (AVA-3)
- Deal Radar (AVA-4)

---

## AVA-3 — Market Data Foundation

**Prerequisites:**
- AVA-2 complete
- Legal review: authorised marketplace data feed contracts completed
- Marketplace terms of service review completed for each source

**Scope:**
- First authorised marketplace data feed integrated (not scraping)
- Market listings table deployed and ingesting (autovaleur_market_listings, autovaleur_listing_price_snapshots)
- Asking price vs completed sale price separated at ingestion (AD-A3)
- Duplicate detection (image hash and plate matching)
- Stale listing decay applied (listings older than 60 days reduced in weight)
- Source trust scoring enforced
- Comparable engine running on real market data
- Liquidity score computation (autovaleur_liquidity_scores)
- Model accuracy monitoring enabled (compare valuation prediction to observed sale)
- Model version increment on any rule change

**Not in AVA-3:**
- Completed transaction price collection (pending legal review)
- Deal Radar (AVA-4)

---

## AVA-4 — Deal Radar MVP

**Prerequisites:**
- AVA-3 complete
- Legal review: Deal Radar listing source terms, acquisition pipeline handling
- Explicit authorisation from Mythos project leadership
- Mythos notification service integration ready

**Scope:**
- Deal Radar pipeline fully activated (MYTHOS_PRIVATE)
- Deal alert tables deployed (autovaleur_deal_alerts, autovaleur_deal_pipeline)
- Automated opportunity score computation on new listings
- Deal alert notification to Mythos Super Admin (human review required before any action)
- Deal pipeline management: shortlist, review, contact authorisation, negotiation, purchase, close
- Transaction recording (autovaleur_transactions)
- Predicted vs realised margin analysis
- Regional opportunity analysis (MYTHOS_PRIVATE)
- Acquisition pipeline management interface

**Invariants (non-negotiable):**
- No automatic purchase
- No automatic seller contact
- No bypass of marketplace terms of service
- Human review required before any pipeline state advance past shortlisted

---

## AVA-5 — Marketplace Integration and Completed Sales

**Prerequisites:**
- AVA-4 complete
- Legal review: completed transaction price data handling, GDPR/data retention, cross-border sales

**Scope:**
- Completed sale price data integrated (separate from asking price — always)
- Time-to-sale data integrated for accurate liquidity scores
- Model accuracy feedback loop active (valuation vs actual sale price comparison)
- Model retrained and version-incremented based on accuracy data
- Opportunity score recalibrated against realised margins
- Public marketplace listing capability (future marketplace integration)
- Seller-facing valuation as listing tool (public product)

---

## AVA-6 — Model Maturity and Ecosystem Expansion

**Prerequisites:**
- AVA-5 complete
- Sufficient real transaction data for model evaluation

**Scope:**
- ML-augmented valuation model (deferred until sufficient clean data)
- General spare-parts platform integration (beyond ssangyong.autos)
- Multi-region analysis (governorate-level market intelligence)
- Fleet and insurer professional tier
- AutoValeur embedded in Fixpert customer-facing flow
- AutoValeur embedded in future Mythos marketplace listing flow
- Full model performance dashboard (MYTHOS_PRIVATE)

---

## LEGAL-REVIEW-REQUIRED — Blocking Items

Items that must be legally reviewed before the indicated stage can begin.

| Item | Blocking stage |
|------|---------------|
| Market listing ingestion from any external marketplace | AVA-3 |
| Marketplace terms of service review per source | AVA-3 |
| Completed transaction price collection and display | AVA-5 |
| Deal Radar activation (listing source terms) | AVA-4 |
| Spare-parts data ingestion from external platforms | AVA-2 |
| Atelier Network repair estimate data reuse for valuation | AVA-2 |
| ID Auto vehicle data reuse for valuation | AVA-1 |
| Professional subscriber data retention and GDPR compliance | AVA-2 |
| Publication of valuation affecting financial decisions | AVA-1 |
| Image data from marketplace listings (copyright) | AVA-3 |
| Seller identity and contact data handling | AVA-3 |
| Deal pipeline records and acquisition intelligence | AVA-4 |
| Aggregate market statistics publication | AVA-3 |
| Cross-border or diplomatic vehicle valuation | AVA-6 |
| AI-driven valuation used in official documents | AVA-6 |
| General spare-parts platform integration | AVA-6 |
| Completed sale price as primary comparable input | AVA-5 |
