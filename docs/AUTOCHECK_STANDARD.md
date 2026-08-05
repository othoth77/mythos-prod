# AutoCheck — Inspection Standard

**Governed by:** Mythos Atelier Network
**Standard version:** 0.1-draft (ATN-0)
**Last updated:** 2026-08-05
**Status:** DRAFT — Specification only. No inspections performed in ATN-0.

---

## 1. What AutoCheck Is

AutoCheck is a **provider-neutral** pre-purchase vehicle inspection protocol and condition report standard. It is governed by Mythos Atelier Network as an ecosystem-wide quality standard.

Any workshop accredited by Mythos Atelier Network may deliver an AutoCheck inspection. The report is branded with the delivering provider's name.

**This is not an exclusive Fixpert product.** Fixpert is the first accredited provider. Future accredited providers will deliver AutoCheck reports under the same standard.

---

## 2. Report Branding Rules

| Provider | Report name |
|----------|-------------|
| Fixpert | `AutoCheck by Fixpert` |
| Any other accredited partner | `AutoCheck — [Workshop Name]` |
| Generic brand (no specific provider) | `AutoCheck` |

**Prohibited wording:**
- `Expertise légale certifiée` — this implies legal certification and professional indemnity coverage that has not been legally reviewed or obtained. This wording is permanently prohibited until specific legal review and authorisation is completed (R-L06 — OPEN).
- `Rapport d'expertise officiel` — same prohibition
- Any wording implying regulatory or judicial authority

**Badge wording (for ecosystem use):**
- `Inspecté par Fixpert` — inspection badge when Fixpert is the provider
- `Inspecté par [Workshop Name]` — badge for other accredited providers

---

## 3. Accreditation Requirements

A workshop may only deliver AutoCheck reports if it holds a valid `atn_workshop_accreditations` record of type `AUTOCHECK_PROVIDER`.

**Requirements for accreditation:**
- Signed AutoCheck provider agreement with Mythos Atelier Network
- At least one `INSPECTOR`-certified technician on staff
- Accreditation must be renewed annually (or on expiry, whichever is earlier)
- Legal review must be completed for inspection report liability before first report issued

**Accreditation is per-organisation, not per-site.** A multi-site organisation must designate which sites are authorised to perform AutoCheck inspections.

---

## 4. Inspection Protocol — 17 Sections

The AutoCheck protocol covers 17 defined sections. All sections are mandatory for a PASS or FAIL result. Individual items within a section may be marked `NOT_APPLICABLE` where technically appropriate (e.g. battery section for a non-hybrid/EV vehicle).

| # | Section code | Section name |
|---|-------------|-------------|
| 1 | `IDENTITY_DOCS` | Identity and Documents |
| 2 | `DIAGNOSTIC` | Diagnostic Scan (OBD / Fault Codes) |
| 3 | `ENGINE` | Engine Condition |
| 4 | `GEARBOX` | Gearbox and Transmission |
| 5 | `BRAKES` | Braking System |
| 6 | `SUSPENSION` | Suspension and Steering |
| 7 | `TYRES` | Tyres and Wheels |
| 8 | `BATTERY_EV` | Battery and EV/Hybrid Systems |
| 9 | `ELECTRICAL` | Electrical Systems |
| 10 | `AIRCON` | Air Conditioning |
| 11 | `BODYWORK` | Bodywork and Paint |
| 12 | `ROAD_TEST` | Road Test |
| 13 | `REPAIR_IMMEDIATE` | Immediate Repair Requirements |
| 14 | `REPAIR_FUTURE` | Future Repair Timeline |
| 15 | `PARTS_ESTIMATE` | Parts Estimate |
| 16 | `LABOUR_ESTIMATE` | Labour Estimate |
| 17 | `RISK_NOTES` | Risk Notes and Recommendations |

---

## 5. Section Ratings

Each section carries an overall result:

| Result | Meaning |
|--------|---------|
| `OK` | No defects or concerns |
| `ATTENTION` | Minor issues or wear noted; monitoring or scheduled service recommended |
| `FAIL` | Significant defect; repair required before or immediately after purchase |
| `NOT_APPLICABLE` | Section not applicable to this vehicle (e.g. EV battery section for petrol vehicle) |
| `NOT_CHECKED` | Section could not be completed (must be documented with reason) |

**Overall report rating:**

| Rating | Meaning |
|--------|---------|
| `PASS` | All mandatory sections OK or ATTENTION; no FAIL |
| `PASS_WITH_NOTES` | At least one ATTENTION; no FAIL; inspector notes recommend review |
| `FAIL` | At least one section rated FAIL |
| `INCOMPLETE` | At least one section NOT_CHECKED; report may not be used for purchase decisions |

---

## 6. Finding Severity

Individual findings within each section are classified by severity:

| Severity | Meaning |
|----------|---------|
| `CRITICAL` | Safety risk; vehicle should not be driven until repaired |
| `HIGH` | Significant defect; repair required before purchase recommended |
| `MEDIUM` | Defect; repair required within defined period |
| `LOW` | Minor wear; monitoring or next-service repair |

---

## 7. Repair Estimate Output

AutoCheck inspections must produce a structured repair estimate for any findings rated MEDIUM or above:

| Field | Requirement |
|-------|-------------|
| Urgency per finding | IMMEDIATE / NEXT_SERVICE / MONITORING |
| Labour estimate (hours + TND) | Required for MEDIUM+ findings |
| Parts estimate (reference + TND) | Required where parts replacement is recommended |
| Total estimate (TND) | Sum of all labour and parts estimates |
| Confidence level | HIGH / MEDIUM / LOW (based on parts availability data) |
| Valid until | Date; estimate is a point-in-time snapshot |

The repair estimate is published via the Atelier Network inspection API and consumed by AutoValeur for post-inspection valuation.

**Display wording in AutoValeur (and any ecosystem context):**
- `"Estimation après inspection [Workshop Name]"` — for post-inspection valuation updates
- Never: `"Expertise légale certifiée"` or equivalent

---

## 8. Report Distribution and Access

| Audience | Scope | Content |
|----------|-------|---------|
| Workshop organisation | `organization_private` | Full inspection findings, all items, all notes |
| Vehicle owner / buyer | Via workshop | Paper or PDF report from provider; not stored in ecosystem |
| AutoValeur | `professional` | Structured repair estimate summary; no customer PII |
| AutoMarket Verified | `professional` | Inspection badge: pass/fail/date; no detailed findings |
| Professional subscriber | `professional` | Inspection history by vehicle_id: provider, date, overall rating |
| Mythos Super Admin | `mythos_private` (audit-logged) | Full inspection data across all organisations |

---

## 9. Vehicle Identity Linkage

Every AutoCheck inspection **must** link to a `vehicle_id` from ID Auto before the report is issued. If no `vehicle_id` exists for the inspected vehicle:

1. The inspector submits the plate and available vehicle data to ID Auto's ingestion flow
2. ID Auto creates an observation and (where data is sufficient) a vehicle fiche
3. ID Auto returns a `vehicle_id`
4. The inspection record is then linked to the confirmed `vehicle_id`

Inspections without a confirmed `vehicle_id` must not be issued as final reports.

---

## 10. Scope Exclusions

The following are outside the AutoCheck standard:

- **Legal certification** — AutoCheck is a factual condition assessment, not a legal expert opinion
- **Price guarantee** — The report does not guarantee the vehicle's value
- **Hidden defects** — AutoCheck only records what is observable during the inspection
- **Post-purchase warranty** — Not implied by the report
- **Insurance claim** — AutoCheck reports may be used as supporting evidence but are not insurance assessments

---

## 11. LEGAL-REVIEW-REQUIRED

| Item | Status |
|------|--------|
| Inspection report liability wording approved (R-L06) | OPEN — blocking ATN-1 / ATN-2 |
| Professional indemnity insurance for inspection providers | OPEN |
| Permitted use of "AutoCheck" branding by partner workshops | OPEN |
| Data retention for inspection records | OPEN (follows general R-L07) |
