# Mythos Automotive — KPI Model

**Stage:** ATN-0 Atelier Network Foundation and Ecosystem Consistency Amendment (amends MAE-0)
**Last updated:** 2026-08-05
**Repository:** othoth77/mythos-prod

---

**Note:** No current KPI values are provided. This document defines formulas and required data sources only. All values are targets or definitions, not current measurements.

---

## 1. Portfolio KPIs

### 1.1 Users and Organisations

| KPI | Formula | Source |
|-----|---------|--------|
| Active users (30d) | Unique authenticated users with at least one action in 30 days | Mythos Core sessions |
| Professional organisations | Count of verified subscriber organisations (active subscription) | Mythos Core |
| Partner organisations | Count of confirmed partner orgs (garages, suppliers, marketplace sellers) | Mythos Core |
| New professional orgs (monthly) | Count of organisations reaching VERIFIED status this month | Mythos Core |
| Professional org retention (12m) | Orgs with active subscription at month 12 / orgs who started month 1 | Mythos Core billing |

### 1.2 Revenue and Margin

| KPI | Formula | Source |
|-----|---------|--------|
| Monthly revenue | Sum of all product subscription and transaction fees billed this month | Mythos billing |
| Recurring monthly revenue (MRR) | Sum of subscription fees for the current month | Mythos billing |
| Gross margin | (Revenue - direct cost of revenue) / Revenue | Accounting |
| Operating cost | Total operating expenditure per month | Accounting |
| Customer acquisition cost (CAC) | Total sales/marketing spend / new paying customers acquired | Accounting + Mythos billing |
| Retention rate (12m) | Paying customers at month 12 / paying customers at month 1 | Mythos billing |

---

## 2. ID Auto KPIs

### 2.1 Database Scale

| KPI | Formula | Source |
|-----|---------|--------|
| Total vehicle fiches | COUNT(idauto_vehicles) | ID Auto |
| Verified vehicle fiches | COUNT(idauto_vehicles WHERE fiche_status = 'verified') | ID Auto |
| Vehicle fiches by region | COUNT per governorate | ID Auto |
| Unique plates | COUNT(DISTINCT plate_number) | ID Auto |

### 2.2 Data Quality

| KPI | Formula | Source |
|-----|---------|--------|
| Observation acceptance rate | Accepted observations / total observations (trailing 30d) | idauto_observations |
| Average confidence score | AVG(confidence_score) on verified vehicle facts | idauto_vehicle_facts |
| High-confidence facts (≥0.90) | COUNT facts WHERE confidence_score >= 0.90 | idauto_vehicle_facts |
| Duplicate detection rate | Observations marked duplicate / total observations (30d) | idauto_observations |
| Review queue depth | COUNT(idauto_review_queue WHERE resolution IS NULL) | idauto_review_queue |
| Review queue age (median) | MEDIAN(now() - created_at) for open queue items | idauto_review_queue |
| Plate format unverified ratio | COUNT plates with unverified format / total plates | idauto_plates JOIN idauto_plate_formats |

### 2.3 Coverage

| KPI | Formula | Source |
|-----|---------|--------|
| Governorate coverage | Count of governorates with ≥ 10 vehicle fiches | ID Auto |
| Make/model coverage | Count of distinct (make, model) combinations | ID Auto |

---

## 3. Atelier Network KPIs

**Note:** All ATN KPIs are design specifications. No values are measured in ATN-0. Activation from ATN-1 onwards.

### 3.1 Network Scale

| KPI | Formula | Source |
|-----|---------|--------|
| Active workshops on network | COUNT(atn_workshops WHERE status = 'ACTIVE') | Atelier Network |
| Workshop organisations registered | COUNT(atn_workshop_organizations WHERE status = 'ACTIVE') | Atelier Network |
| New workshop onboardings (monthly) | COUNT workshops reaching ACTIVE status this month | Atelier Network |
| Active integration connectors | COUNT(atn_integration_connectors WHERE status = 'ACTIVE') by mode | Atelier Network |
| Governorate coverage | Count of governorates with at least one ACTIVE workshop | Atelier Network |

### 3.2 Inspection and AutoCheck Quality

| KPI | Formula | Source |
|-----|---------|--------|
| AutoCheck reports issued (monthly) | COUNT(atn_inspections WHERE report_issued = true) this month | Atelier Network |
| Accredited inspection providers | COUNT(atn_inspection_providers WHERE accreditation_status = 'ACCREDITED') | Atelier Network |
| Inspection completion rate | Inspections reaching status COMPLETED / inspections started (monthly) | Atelier Network |
| Overall rating distribution | COUNT per overall_rating (OK / ATTENTION / FAIL) on completed inspections | Atelier Network |
| Average finding count per inspection | AVG(COUNT findings) per completed inspection | Atelier Network |
| FAIL-rated finding resolution rate | Findings with severity FAIL that received a work order / total FAIL findings | Atelier Network |

### 3.3 Appointment and Work Order Operations

| KPI | Formula | Source |
|-----|---------|--------|
| Appointments volume (monthly) | COUNT(atn_appointments WHERE status != 'CANCELLED') this month | Atelier Network |
| Appointment to inspection conversion | Inspections created with linked appointment / total confirmed appointments | Atelier Network |
| Inspection to repair estimate conversion | Repair estimates issued / inspections completed (monthly) | Atelier Network |
| Work orders closed (monthly) | COUNT(atn_work_orders WHERE status = 'CLOSED') this month | Atelier Network |

### 3.4 Integration Health

| KPI | Formula | Source |
|-----|---------|--------|
| EXTERNAL_CONNECTED sync success rate | Successful external record syncs / total attempted syncs (daily) | Atelier Network |
| Repair estimate API availability | Uptime of ATN repair estimate endpoint (target: 99.5%) | Platform monitoring |
| ATN → ID Auto vehicle_id resolution rate | vehicle_id resolved / total vehicle lookup requests | Atelier Network + ID Auto |

---

## 4. Fixpert KPIs (First Pilot)

**Note:** These KPIs apply specifically to Fixpert as the first workshop pilot. They will be extended to other workshop organisations when they join the Atelier Network.

### 4.1 Workshop Operations

| KPI | Formula | Source |
|-----|---------|--------|
| Appointments (monthly) | COUNT appointments confirmed this month | Fixpert |
| Appointment to work order conversion | Work orders opened / appointments confirmed (monthly) | Fixpert |
| Average repair value (TND) | AVG(invoice total) per closed work order | Fixpert |
| Labour utilisation | Billable labour hours / available labour hours | Fixpert |
| Parts gross margin | (Parts selling price - parts cost) / Parts selling price | Fixpert |
| Customer revisit rate (12m) | Customers with ≥ 2 visits in 12m / total active customers | Fixpert |
| Vehicle downtime | AVG(work order close date - work order open date) | Fixpert |
| Customer satisfaction | Survey score or NPS if implemented | Fixpert |

---

## 5. Parts Network KPIs

### 4.1 Catalogue Quality

| KPI | Formula | Source |
|-----|---------|--------|
| Catalogue coverage | Count of part references with fitment data / total catalogue | Parts |
| Fitment accuracy rate | Confirmed compatible fitments / total fitment claims | Parts + Fixpert feedback |
| Stock availability rate | Parts in-stock / total active catalogue | Parts |

### 4.2 Commerce

| KPI | Formula | Source |
|-----|---------|--------|
| Order conversion | Orders placed / product page views | Parts analytics |
| Average basket value (TND) | AVG(order total) | Parts |
| Fulfilment time | AVG(delivery date - order date) | Parts |
| Return rate | Orders returned / orders placed (monthly) | Parts |
| Parts gross margin | (Selling price - purchase price) / Selling price | Parts accounting |

---

## 6. AutoValeur KPIs

### 5.1 Valuation Volume and Quality

| KPI | Formula | Source |
|-----|---------|--------|
| Valuations (monthly) | COUNT(autovaleur_valuations) this month | AutoValeur |
| Public valuations | COUNT WHERE requester_type = 'public' | AutoValeur |
| Professional valuations | COUNT WHERE requester_type = 'professional' | AutoValeur |
| Average confidence score | AVG(confidence_score) on valuations | AutoValeur |
| High-confidence valuations (≥0.80) | COUNT WHERE confidence_score >= 0.80 | AutoValeur |
| Comparable count distribution | PERCENTILE_CONT(comparable_count) for recent valuations | AutoValeur |

### 5.2 Model Accuracy

| KPI | Formula | Source |
|-----|---------|--------|
| Mean absolute error (TND) | AVG(ABS(central_market_value - actual_sale_price)) for matched valuations | AutoValeur + AutoMarket |
| Mean absolute percentage error | AVG(ABS(central_market_value - actual_sale_price) / actual_sale_price) | AutoValeur + AutoMarket |
| Hit rate (estimate in range) | COUNT WHERE actual_sale_price BETWEEN estimated_range_min AND estimated_range_max / matched valuations | AutoValeur + AutoMarket |
| Time to sale accuracy | AVG(ABS(expected_resale_days - actual_days_to_sale)) | AutoValeur + AutoMarket |

### 5.3 Deal Radar (MYTHOS_PRIVATE)

| KPI | Formula | Source |
|-----|---------|--------|
| Deals detected (monthly) | COUNT(autovaleur_deal_alerts) this month | AutoValeur |
| Deals shortlisted | COUNT(autovaleur_deal_pipeline WHERE pipeline_state = 'shortlisted') | AutoValeur |
| Shortlist precision | Deals that resulted in purchase / total shortlisted | AutoValeur |
| Predicted vs realised margin | AVG(realised_margin - estimated_margin) | AutoValeur |

---

## 7. AutoMarket KPIs (Future)

### 6.1 Listings and Sales

| KPI | Formula | Source |
|-----|---------|--------|
| Active listings | COUNT listings WHERE status = 'published' | AutoMarket |
| Verified listings | COUNT listings with identity_checked badge | AutoMarket |
| Listing leads | COUNT leads per listing | AutoMarket |
| Listing to offer rate | Listings receiving at least one offer / total active listings | AutoMarket |
| Offer acceptance rate | Accepted offers / total offers made | AutoMarket |
| Transaction count (monthly) | COUNT completed sales this month | AutoMarket |
| Average transaction value (TND) | AVG(completed_sale_price) | AutoMarket |
| Seller conversion | Sellers who publish at least one listing / sellers who register | AutoMarket |
| Time to sale | AVG(sale_date - listing_date) for sold listings | AutoMarket |

---

## 8. KPI Governance Rules

### 7.1 Data Requirements

- All KPI calculations must reference the owning product's tables
- Cross-product KPIs (e.g. model accuracy requiring both AutoValeur and AutoMarket) must use an authorised and privacy-safe data pipeline
- Individual vehicle movements must not appear in any aggregate analytics product accessible outside MYTHOS_PRIVATE scope

### 7.2 Model Accuracy Requirements

- Model accuracy KPIs require matched valuations: a valuation must be linked to a completed sale of the same vehicle to measure accuracy
- The linkage is via `vehicle_id` from ID Auto — another reason `vehicle_id` stability is the top priority
- No accuracy KPI is meaningful until a sufficient number of completed sales have been recorded: minimum 50 matched pairs per vehicle segment before publishing accuracy metrics

### 7.3 KPI Definition Versioning

- When a KPI definition changes (formula, source, segment), the previous definition is archived with its effective date
- Historical KPI data is re-computed against the new definition only if feasible and documented
- KPI definitions are versioned in the control plane KPI registry

---

## 9. Strategic Milestones

These are target milestones for portfolio tracking, not guaranteed forecasts.

| Milestone | ID Auto fiches | ATN workshops | ATN work orders/year | AutoValeur valuations/month | AutoMarket listings |
|-----------|---------------|---------------|----------------------|------------------------------|---------------------|
| Alpha | 1,000 | 1 (Fixpert) | 500 | 200 | 0 (not yet) |
| Early growth | 10,000 | 3–5 | 2,000 | 2,000 | 100 |
| Network scale | 100,000 | 20+ | 10,000 | 20,000 | 1,000 |
| National scale | 500,000+ | 100+ | 50,000+ | 100,000+ | 10,000+ |

Milestones are indicators, not commitments. Each depends on legal approvals, partner agreements, and data quality reaching specified thresholds.
