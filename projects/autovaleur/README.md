# AutoValeur

**Product:** AutoValeur
**Platform:** Mythos ecosystem
**Repository:** othoth77/mythos-prod (`projects/autovaleur/`, `docs/AUTOVALEUR_*.md`)
**Current stage:** AVA-0 — Foundation and Ecosystem Roadmap (2026-08-05)
**Status:** Planning — no real data, no deployment, no implementation

---

## Purpose

AutoValeur is an independent vehicle valuation and Tunisian used-car market intelligence product inside the Mythos ecosystem.

**Tagline:** AutoValeur — Estimation automobile et intelligence du marché tunisien.

**Primary public promise:** La vraie valeur de votre voiture.

**Arabic:** اعرف القيمة الحقيقية لسيارتك.

AutoValeur is not a simple price calculator. Its long-term purpose is to combine:

- Tunisian market data (asking prices, listing history, completed transactions)
- ID Auto vehicle identity and verified technical facts
- Fixpert inspection and repair estimates
- Spare-parts price and availability data (ssangyong.autos and future platforms)
- Marketplace listing data
- Completed-sale transaction data
- Liquidity and risk analysis
- Private deal detection and opportunity intelligence (Mythos-private)

---

## Three Product Versions

### AutoValeur Public

Available to the general public:

- Manual vehicle details entry
- ID Auto plate or vehicle lookup (where authorised)
- Estimated market value range
- Estimated quick-sale price
- Confidence score
- Comparable-vehicle summary
- Factors increasing or decreasing the estimate
- Recommendations to improve sale value
- Option to request a Fixpert inspection
- Option to publish on the future marketplace

**Never exposed publicly:** private ID Auto observations, exact vehicle movements, raw images, Fixpert private records, private invoices, Mythos acquisition strategy, deal alerts, confidential model internals.

### AutoValeur Pro

For verified professional subscribers:

- Professional purchase price
- Estimated professional resale value
- Repair and reconditioning estimate
- Expected gross and net margin
- Expected resale period
- Bulk fleet and stock valuation
- Valuation reports and API access
- Price alerts
- Fixpert inspection integration
- Spare-parts estimate integration

### AutoValeur Intelligence (Mythos-Private)

Internal decision-support for the Mythos ecosystem:

- All permitted raw market inputs
- Full price-change history
- Actual purchase and completed-sale prices
- Real Fixpert repair and parts costs
- Predicted vs. realised margin analysis
- Deal detection and opportunity ranking
- Regional opportunity analysis
- Model performance monitoring
- Acquisition pipeline management
- Audited Mythos Super Admin access

The Intelligence version must never be offered as a public vehicle-tracking or owner-profiling service.

---

## Key Valuation Outputs

Every AutoValeur result returns a range and supporting metrics, not a single number:

| Output | Description |
|--------|-------------|
| Estimated market range | Min–max based on comparable analysis |
| Central market value | Weighted median of comparable set |
| Quick-sale price | Estimated price for fast transaction |
| Professional purchase price | Recommended buy price for trade professionals |
| Professional resale price | Expected resale after reconditioning |
| Repair/reconditioning cost | Estimated total cost to market-ready condition |
| Additional expenses | Transport, admin, holding costs |
| Potential gross margin | Resale minus purchase and repair |
| Potential net margin | After all estimated costs |
| Expected resale time | Estimated days to sale |
| Liquidity score | How easy the vehicle is to resell |
| Opportunity score | Decision-support ranking |
| Confidence score | 0–100% based on data quality and comparable count |
| Valuation date | When the estimate was produced |
| Model version | Which valuation model version was used |

All values are estimates. They are not guaranteed sale prices and do not constitute certified legal valuations.

---

## Ecosystem Integrations

| Product | Integration role |
|---------|-----------------|
| Mythos OS | Authentication, roles, permissions, audit, reporting, private intelligence |
| ID Auto | Vehicle identity, plate history, verified technical facts, confidence scores |
| Fixpert Atelier | Inspections, diagnostics, repair estimates, labour costs, parts lists |
| ssangyong.autos | Spare-parts prices, availability, compatibility |
| Future parts platform | General spare-parts catalogue and pricing |
| Future marketplace | Listing prices, price history, offers, completed transaction prices |

Ownership boundaries are respected across all integrations. AutoValeur stores valuation snapshots and authorised references. It does not duplicate or own data that belongs to ID Auto, Fixpert, spare-parts platforms, or the marketplace.

---

## Data Status

**No real data is ingested in AVA-0.**

- No marketplace scraping
- No real vehicle listings
- No Fixpert customer or invoice data
- No spare-parts catalogue data
- All feature flags: `false`
- PostgreSQL: selected as target DBMS, not installed

---

## Repository Layout

```
projects/autovaleur/
├── README.md                           ← this file
├── config/
│   └── autovaleur.example.json         ← configuration draft (AVA-0)
└── database/
    └── schema.sql                      ← draft schema (PostgreSQL, not deployed)

docs/
├── AUTOVALEUR_PRODUCT_SPEC.md          ← full product specification
├── AUTOVALEUR_ARCHITECTURE.md          ← architecture decisions, integrations
└── AUTOVALEUR_ROADMAP.md               ← AVA-0 through AVA-6 stage plan
```

---

## Next Stage

**AVA-1 — Public Calculator MVP**

- Manual vehicle entry form
- Transparent rule-based valuation engine
- Synthetic and authorised market dataset
- Estimated range, quick-sale price, confidence score
- Comparable-vehicle summary
- Save valuation
- Clear disclaimer
- No public scraping, no Deal Radar
