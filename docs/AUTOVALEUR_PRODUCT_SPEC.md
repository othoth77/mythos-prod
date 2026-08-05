# AutoValeur — Product Specification

**Stage:** AVA-0 Foundation and Ecosystem Roadmap
**Last updated:** 2026-08-05
**Platform:** Mythos ecosystem
**Repository:** othoth77/mythos-prod

---

## 1. Product Identity

**Official name:** AutoValeur
**Display spelling:** AutoValeur
**Generic textual spelling:** Auto Valeur (acceptable in plain-text contexts)
**Tagline:** AutoValeur — Estimation automobile et intelligence du marché tunisien.
**Primary public promise:** La vraie valeur de votre voiture.
**Arabic:** اعرف القيمة الحقيقية لسيارتك.

AutoValeur is an independent vehicle valuation and Tunisian used-car market intelligence product inside the Mythos ecosystem. It is not a simple price calculator. Its purpose is to progressively combine market data, vehicle identity, inspection results, parts costs, and transaction history to produce the most accurate and trustworthy vehicle valuation available in the Tunisian market.

---

## 2. Ecosystem Position

AutoValeur is one product node in the Mythos ecosystem. Each node has defined data ownership and integration contracts.

```
Mythos OS
├── Global administration
├── Authentication and session management
├── Roles and permissions
├── Audit trail
├── Reporting
└── Private business intelligence

ID Auto
├── Vehicle identity (canonical fiche)
├── Plate history
├── VIN (when legally authorised)
├── Verified technical facts
├── Observations and evidence
└── Vehicle data confidence score

Fixpert Atelier
├── Customers and appointments
├── Inspections and diagnostics
├── Work orders and interventions
├── Labour estimates
├── Quotations and invoices
└── Payments

Spare-parts platforms
├── ssangyong.autos
├── Future general spare-parts website
├── Compatible parts catalogue
├── Parts prices and availability
└── Estimated procurement delays

Marketplace (future)
├── Listings and asking prices
├── Price history
├── Views and enquiries (where authorised)
├── Offers and accepted offers
├── Completed transaction prices (where available)
└── Time to sale

AutoValeur
├── Market valuation (range + central value)
├── Quick-sale valuation
├── Professional purchase price
├── Estimated resale price
├── Repair and reconditioning estimate
├── Liquidity score
├── Opportunity score
├── Confidence score
└── Mythos Deal Radar (MYTHOS_PRIVATE)
```

### 2.1 Ownership Boundaries

| Data domain | Owner | Schema |
|---|---|---|
| Valuation records and model outputs | AutoValeur / Mythos | autovaleur |
| Vehicle identity and evidence-backed facts | ID Auto / Mythos | idauto |
| Customers, inspections, work orders, invoices, payments | Fixpert | fixpert |
| Parts catalogues, sales, commercial records | ssangyong.autos / future platforms | external |
| Listings, sellers, leads, transactions | Marketplace | external |
| Global auth, roles, audit | Mythos OS | mythos_core |

AutoValeur uses stable IDs to reference data owned by other systems. It does not duplicate or own data belonging to ID Auto, Fixpert, spare-parts platforms, or the marketplace. Integration is through defined contracts, not direct cross-schema writes.

---

## 3. Three Product Versions

### 3.1 AutoValeur Public

Available to any person without authentication or subscription.

**Inputs accepted:**
- Manual vehicle details (make, model, year, fuel, mileage, condition)
- ID Auto plate lookup (where technically and legally authorised)
- ID Auto carte grise scanner integration (future stage)

**Outputs provided:**
- Estimated market value range (min–max)
- Estimated quick-sale price
- Confidence score with explanation
- Number of comparable vehicles found
- Key factors increasing the estimate
- Key factors decreasing the estimate
- Recommendations to improve sale value
- Option to request a Fixpert inspection
- Option to publish on the future marketplace

**Never exposed in public output:**
- Private ID Auto observations
- Exact vehicle movement history
- Raw capture images
- Fixpert private customer records
- Private work orders, invoices, or payments
- Mythos acquisition strategy or deal alerts
- Confidential model weights or internals
- Marketplace seller identity (unless voluntarily published there)
- Any owner-profiling information

### 3.2 AutoValeur Pro

Available to verified professional subscribers (dealers, fleet managers, auction houses, finance companies).

**Additional outputs vs. Public:**
- Professional purchase price (recommended buy at auction or private)
- Estimated professional resale value (after reconditioning)
- Repair and reconditioning cost estimate
- Expected gross margin
- Expected net margin (after all costs)
- Expected resale time range
- Bulk fleet or stock valuation
- Exportable valuation reports (PDF)
- API access (rate-limited)
- Price-change alerts for watched vehicle segments
- Fixpert inspection integration (inspection-confirmed valuation)
- Spare-parts estimate integration

**Access controls:**
- Verified organisation with active subscription
- Role-based within organisation (owner, admin, member, readonly)
- Consent records per data-processing purpose
- Organisation does not see another organisation's private data

### 3.3 AutoValeur Intelligence (MYTHOS_PRIVATE)

Internal decision-support for the Mythos ecosystem. Not available as a public or professional subscription product.

**Additional capabilities vs. Pro:**
- All permitted raw market inputs and source metadata
- Full price-change history including withdrawn listings
- Actual purchase prices and completed sale prices
- Real Fixpert repair and parts costs (authorised references)
- Parts cost and availability per repair line
- Predicted vs. realised margin comparison
- Deal detection pipeline (Mythos Deal Radar)
- Opportunity ranking by score and region
- Regional opportunity analysis by governorate
- Model performance monitoring (accuracy metrics)
- False-positive review and audit
- Acquisition pipeline management
- Audited Mythos Super Admin access to all data

**Constraint:** The Intelligence version must never be offered as a public vehicle-tracking or owner-profiling service. Its purpose is business intelligence and operational support for the Mythos ecosystem, not surveillance.

---

## 4. Valuation Output Definition

AutoValeur must not return a single number. Every valuation result must provide:

| Field | Type | Scope |
|---|---|---|
| estimated_range_min | Currency (TND) | PUBLIC |
| estimated_range_max | Currency (TND) | PUBLIC |
| central_market_value | Currency (TND) | PUBLIC |
| quick_sale_price | Currency (TND) | PUBLIC |
| professional_purchase_price | Currency (TND) | PROFESSIONAL |
| professional_resale_price | Currency (TND) | PROFESSIONAL |
| repair_reconditioning_estimate | Currency (TND) | PROFESSIONAL |
| additional_expenses_estimate | Currency (TND) | PROFESSIONAL |
| gross_margin_estimate | Currency (TND) | PROFESSIONAL |
| net_margin_estimate | Currency (TND) | PROFESSIONAL |
| expected_resale_days_min | Integer | PROFESSIONAL |
| expected_resale_days_max | Integer | PROFESSIONAL |
| liquidity_score | Enum | PUBLIC |
| opportunity_score | Enum | PROFESSIONAL |
| confidence_score | Float 0–100 | PUBLIC |
| comparable_count | Integer | PUBLIC |
| valuation_date | Date | PUBLIC |
| model_version | String | PUBLIC |
| data_source_summary | Text | PUBLIC |

**Example output (illustrative — not a real valuation):**

```
Valeur marché estimée :      40 000 – 43 500 TND
Prix de vente rapide :       37 500 – 39 500 TND
Prix achat professionnel :   33 000 – 36 000 TND
Prix revente professionnel : 42 000 – 45 000 TND
Remise en état estimée :      2 800 TND
Marge potentielle brute :     4 200 TND
Délai de vente estimé :      15 – 30 jours
Score de liquidité :          Liquide
Confiance :                   86 %
Comparables :                 14 annonces actives
```

All values are estimates. They are not guaranteed sale prices. AutoValeur does not provide certified legal valuations. Do not use the wording "expertise légale certifiée" until a future legal and professional review explicitly authorises it.

---

## 5. Valuation Factors

### 5.1 Vehicle Identity Inputs

| Factor | Source |
|---|---|
| Make, model, variant | User input or ID Auto |
| First-registration year | User input or ID Auto |
| Fuel type | User input or ID Auto |
| Transmission | User input or ID Auto |
| Engine and fiscal power | User input or ID Auto |
| Body type | User input or ID Auto |
| Equipment level | User input or ID Auto |
| Plate / VIN (authorised access only) | ID Auto |

### 5.2 Condition Inputs

| Factor | Source |
|---|---|
| Mileage | User input or Fixpert inspection |
| Mechanical condition (engine, gearbox, brakes, suspension, tyres) | User input or Fixpert inspection |
| Bodywork and paint condition | User input or Fixpert inspection |
| Electrical equipment and air conditioning | User input or Fixpert inspection |
| Battery condition (electric/hybrid) | User input or Fixpert inspection |
| Technical inspection results | User input or Fixpert |
| Declared repair and maintenance history | User input |
| Keys and documents availability | User input |

### 5.3 Market Inputs

| Factor | Source |
|---|---|
| Asking prices | Authorised listing sources |
| Listing age and price changes | Authorised listing sources |
| Seller type (private, dealer, auction) | Authorised listing sources |
| Region and governorate | Listing metadata |
| Number of comparable active listings | Market data |
| Supply and demand balance | Market data |
| Seasonal effects | Historical data |
| Completed sale prices (where available) | LEGAL-REVIEW-REQUIRED |

### 5.4 Economic Inputs

| Factor | Source |
|---|---|
| Parts prices and availability | ssangyong.autos, future platforms |
| Fixpert labour estimates | Fixpert Atelier |
| Bodywork and paint costs | Market estimates |
| Transport and logistics | Estimated |
| Administrative costs (registration, etc.) | Estimated |
| Reconditioning delay | Fixpert + parts |
| Risk reserve | Model configuration |

All external data sources require source-specific authorisation before integration. No external source is assumed to be legally or technically available in AVA-0.

---

## 6. Comparable Vehicle Engine

The comparable selection engine identifies vehicles similar to the subject and extracts a price distribution.

### 6.1 Selection Criteria

| Criterion | Weight | Notes |
|---|---|---|
| Same make and model | Required | Must match |
| Same generation | High | Defined by year range |
| Same or equivalent variant | High | |
| Close year (±2) | High | Distance-weighted |
| Close mileage (±20%) | High | Distance-weighted |
| Same fuel | High | |
| Same transmission | Medium | |
| Similar equipment level | Medium | |
| Similar declared condition | Medium | |
| Same seller segment | Medium | Private / dealer / auction |
| Relevant Tunisian region | Medium | Same or adjacent governorate |

### 6.2 Comparable Quality Rules

- **Duplicate detection:** Remove identical images, same phone number, same description across accounts
- **Stale listing reduction:** Weight decreases with listing age beyond median duration
- **Unrealistic price exclusion:** Statistical outlier detection (e.g., >2σ from median)
- **Seller-type separation:** Private and professional prices are tracked separately
- **Minimum comparable count:** Confidence degrades below a configurable threshold (default: 5)
- **Source provenance:** Every comparable records source, observation date, and asking vs. accepted price

### 6.3 Initial Valuation Approach

The initial approach (AVA-1) uses transparent rule-based methods:

1. Weighted comparable analysis (robust statistics — median, trimmed mean)
2. Mileage and age depreciation adjustment
3. Condition discount or premium
4. Supply/demand adjustment
5. Regional adjustment
6. Human review for low-confidence results
7. Model versioning: every rule change increments the model version

Future machine learning is permitted only after sufficient clean historical data exists and model governance is in place.

---

## 7. Liquidity Score

The Liquidity Score estimates how easy a vehicle may be to resell in the Tunisian market.

### 7.1 Contributing Factors

| Factor | Notes |
|---|---|
| Demand for the model | Historical listing turnover rate |
| Number of similar listings | Supply indicator |
| Average listing duration | Time-on-market data |
| Price band | Higher prices typically slower |
| Fuel and running costs | Diesel/electric demand context |
| Brand presence in Tunisia | Parts and service availability |
| Parts availability | From ssangyong.autos and other sources |
| Ease of repair | Common vs. specialist workshop |
| Vehicle category | Passenger, utility, motorcycle |
| Seasonality | Seasonal demand patterns |
| Historical completed sales | When available |

### 7.2 Output Classes

| Class | Meaning | Typical resale time |
|---|---|---|
| Très liquide | Sells quickly, high demand | < 15 days |
| Liquide | Normal demand, reliable market | 15–30 days |
| Moyen | Average demand, some patience needed | 30–60 days |
| Lent | Low demand or niche | 60–120 days |
| Très lent | Difficult to resell | > 120 days |

A resale-time range is shown when confidence allows. The range is an estimate, not a guarantee.

---

## 8. Repair and Reconditioning Cost Pipeline

```
Fixpert Inspection
        ↓
Required Interventions List
        ↓
Parts Compatibility Check
        ↓
Parts Prices and Availability (ssangyong.autos, future platforms)
        ↓
Fixpert Labour Estimate
        ↓
Bodywork, Tyres and Consumables
        ↓
Contingency Reserve (configurable %)
        ↓
Total Reconditioning Estimate
```

### 8.1 Repair Estimate Record

Each repair estimate line must record:

| Field | Description |
|---|---|
| parts_source | ssangyong.autos, catalogue, Fixpert estimate |
| price_date | When the price was observed |
| part_classification | Original / compatible alternative / used |
| quantity | Number of units |
| unit_price | Price per unit (TND) |
| availability | In stock / days to order |
| delivery_estimate_days | Estimated lead time |
| labour_hours | Fixpert estimate |
| labour_rate | Rate per hour (TND) |
| uncertainty_flag | High / medium / low |
| excluded_work | What is NOT included and why |

### 8.2 Ownership Boundary

Fixpert invoices and payment records remain Fixpert-owned in the `fixpert` schema. AutoValeur stores only the valuation snapshot (the estimate total and line-item references). It does not own or duplicate Fixpert financial records.

---

## 9. Opportunity Score

The Opportunity Score is a decision-support metric for professional and Mythos-private users. It is not an automatic purchase instruction.

### 9.1 Dimensions

| Dimension | Weight (configurable) | Description |
|---|---|---|
| Price advantage | — | Listed price vs. estimated market value |
| Technical condition | — | Fixpert inspection result |
| Repair cost | — | Total reconditioning estimate |
| Resale liquidity | — | Liquidity score class |
| Parts availability | — | ssangyong.autos and other sources |
| Data confidence | — | Confidence score from valuation |
| Estimated net margin | — | After all costs |
| Risk level | — | Uncertainty, condition unknowns |

### 9.2 Conceptual Formula

```
Potential Net Margin =
    Expected Resale Value
  − Purchase Price
  − Repair and Reconditioning Costs
  − Parts Costs
  − Administrative and Transport Costs
  − Risk Reserve
```

Weights are version-controlled in the model configuration. They are not hardcoded in AVA-0.

### 9.3 Output Classes

| Class | Meaning |
|---|---|
| Excellente opportunité | Strong margin, good condition, high liquidity |
| Bonne opportunité (après inspection) | Promising but needs Fixpert confirmation |
| Prix de marché normal | Fair price, average margin |
| Risque élevé | High repair cost, low liquidity, or low data confidence |
| Non recommandé | Negative or near-zero margin after costs |

The score is decision support. A human review is required before any acquisition.

---

## 10. Mythos Deal Radar (MYTHOS_PRIVATE)

AutoValeur Radar is a future Mythos-private feature that monitors authorised listing sources and alerts on potential acquisition opportunities.

### 10.1 Pipeline

```
Authorised Listing Source
        ↓
Normalisation
        ↓
Duplicate Detection
        ↓
ID Auto Vehicle Matching
        ↓
Market Valuation
        ↓
Repair and Parts Estimate
        ↓
Liquidity and Risk Analysis
        ↓
Opportunity Score
        ↓
Mythos Alert (MYTHOS_PRIVATE)
        ↓
Human Review
```

### 10.2 Deal Pipeline States

| State | Meaning |
|---|---|
| detected | Listing identified and scored |
| under_review | Human reviewing the alert |
| shortlisted | Potential interest confirmed |
| contacted | Seller contacted (human action) |
| appointment | Visit or inspection scheduled |
| inspected_by_fixpert | Fixpert inspection completed |
| negotiation | Price negotiation in progress |
| purchased | Vehicle acquired |
| rejected | Decision not to proceed (reason stored) |
| sold | Vehicle resold after reconditioning |
| archived | Pipeline entry closed |

### 10.3 Constraints

- No automatic purchase
- No automatic seller contact
- No bypass of marketplace terms or technical protections
- No unauthorised scraping
- All access audit-logged
- Reasons for rejection stored for model calibration

---

## 11. Fixpert Integration Levels

### Level 1 — Indicative Valuation

Uses market and user-provided data only. No Fixpert inspection required. Confidence is lower.

### Level 2 — Post-Inspection Valuation

After a Fixpert inspection:

- Verified mileage (odometer reading)
- Diagnostic findings
- Required repair list
- Parts list and availability
- Labour cost estimate
- Repair delay
- Revised market valuation
- Revised opportunity score

Display wording: "Estimation après inspection Fixpert"

Do NOT use: "Expertise légale certifiée" — unless legally and professionally authorised in a future stage.

Fixpert customer identity remains in the `fixpert` schema. AutoValeur references the authorised inspection report by stable ID only.

---

## 12. Model Governance

Every AutoValeur result must record:

| Field | Description |
|---|---|
| model_version | Version of the valuation rules applied |
| rules_version | Version of comparables selection rules |
| input_timestamp | When inputs were captured |
| data_sources | Which sources contributed |
| comparable_count | Number of comparables used |
| confidence_score | Final confidence percentage |
| missing_fields | Fields not provided, and their impact |
| exclusions | Listings or data excluded and why |
| human_overrides | Whether a human overrode the model |
| override_reason | Reason for override |
| predicted_value | Model output at valuation time |
| later_actual_sale | Actual sale price when later known |

### 12.1 Accuracy Monitoring

Future analysis must compare:

- Predicted price vs. actual sale price
- Predicted repair cost vs. actual Fixpert cost
- Predicted margin vs. realised margin
- Predicted sale duration vs. actual duration

Model updates must never rewrite historical valuation records. A new model version produces new valuations; old valuations retain their original model version.

---

## 13. Manipulation and Fraud Resistance

AutoValeur must implement protections against price manipulation:

| Protection | Method |
|---|---|
| Duplicate image detection | Image hashing |
| Repeated listing detection | Same vehicle across accounts |
| Seller-type separation | Private vs. dealer vs. auction |
| Stale-listing reduction | Age-based weight decay |
| Unrealistic price detection | Statistical outlier removal |
| New-account weighting | Lower trust for new seller accounts |
| Minimum comparable count | Confidence degrades below threshold |
| Price-history storage | Price changes stored, not overwritten |
| VIN/plate verification | Where legally authorised via ID Auto |
| Manual anomaly review | Low-confidence and flagged results |
| Model audit trail | All model decisions recorded |

No single listing may determine a vehicle's valuation. AutoValeur does not claim to eliminate fraud; it reduces its impact on valuation accuracy.

---

## 14. Privacy and Access

### 14.1 Access Scopes

| Scope | Who | Audit |
|---|---|---|
| PUBLIC | Any caller within rate limits | No |
| PROFESSIONAL | Verified subscriber organisations | No |
| MYTHOS_PRIVATE | Mythos Super Admin only | Always |

### 14.2 Public Output Restrictions

Public API responses must never include:

- Vehicle owner identity
- Exact vehicle movement history
- Private ID Auto observations
- Fixpert customer identity
- Private repair invoices or payments
- Marketplace seller identity (unless voluntarily published)
- Private Mythos opportunity notes
- Confidential acquisition prices
- Model-security internals

### 14.3 Professional Access Controls

Professional users see only information permitted by role, organisation, contract, consent, data ownership, and product tier. An organisation does not see another organisation's private data.

### 14.4 Mythos Supervision

Mythos Super Admin may supervise all AutoValeur data and pipeline activity. All privileged access is audit-logged in `autovaleur_audit_events`.

---

## 15. Business Model (Planned)

All revenue streams are documented as future plans. No commercial launch in AVA-0.

### Public Revenue

- Free basic estimate
- Paid advanced report (detailed factors, full comparable set)
- Fixpert inspection booking (referral)
- Marketplace publication (future)
- Qualified professional leads

### Professional Revenue

- Monthly subscription (AutoValeur Pro)
- Vehicle stock valuation service
- Batch valuation reports
- API access
- Repair-cost estimation service
- Parts sourcing integration
- Professional deal alerts

### Ecosystem Revenue

- Fixpert inspection revenue
- Marketplace transaction commission (where legally contracted)
- Spare-parts margin or referral fee
- Fleet valuation contracts
- Business intelligence reports
- Authorised data services

Final pricing is not defined in AVA-0.

---

## 16. LEGAL-REVIEW-REQUIRED

The following items require formal legal review before the corresponding features may be implemented or activated.

| Item | Blocking stage |
|---|---|
| Collection and reuse of marketplace listing data | AVA-1 (market dataset) |
| Marketplace terms of service compliance | AVA-1 |
| Website scraping legality in Tunisia | AVA-4 (Deal Radar) |
| Seller and buyer personal information | AVA-1 |
| Storage of completed transaction prices | AVA-5 |
| Automated valuation disclosures and disclaimers | AVA-1 |
| Professional valuation liability | AVA-3 |
| Fixpert inspection report wording ("expertise certifiée") | AVA-2 |
| Vehicle document processing through ID Auto | AVA-2 |
| Cross-product data sharing (AutoValeur ↔ ID Auto ↔ Fixpert) | AVA-2 |
| Contributor and submitter consent for market data | AVA-1 |
| Data retention periods (all categories) | AVA-1 |
| Data correction and deletion rights | AVA-1 |
| Model profiling and automated decision disclosures | AVA-1 |
| Professional API contracts and terms | AVA-3 |
| Mythos Super Admin access governance | AVA-0 (open) |
| Public disclaimers on valuation accuracy | AVA-1 |

**No real data ingestion begins from AVA-0.**
