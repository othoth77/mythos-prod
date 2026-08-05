# Mythos Automotive — Risk Register

**Stage:** MAE-0 Ecosystem Master Foundation
**Last updated:** 2026-08-05
**Repository:** othoth77/mythos-prod

---

**Likelihood:** H = High, M = Medium, L = Low
**Impact:** H = High, M = Medium, L = Low

---

## 1. Legal and Regulatory Risks

| ID | Domain | Description | L | I | Mitigation | Blocking stage | Status |
|----|--------|-------------|---|---|-----------|----------------|--------|
| R-L01 | ID Auto | No confirmed legal basis for public plate lookup under Tunisian data protection law (organic law 63-2004 + INPDP rules) | H | H | Legal counsel review before IDA-3; no public lookup launched without resolution | IDA-3 | OPEN |
| R-L02 | ID Auto | ANPR regulatory approval (INPDP) not yet obtained for Smart Gate camera operation | H | H | Regulatory pathway mapping; no camera connection before approval | IDA-4 | OPEN |
| R-L03 | AutoValeur | Automated valuation estimates used in financial decisions without regulatory review | M | H | Clear disclaimer on every output; legal review of display wording before AVA-1 | AVA-1 | OPEN |
| R-L04 | AutoValeur | Deal Radar creates conflict-of-interest risk: Mythos simultaneously values vehicles it may acquire | M | H | Document invariants (human review, no auto-purchase, no auto-contact); consider governance structure | AVA-4 | OPEN |
| R-L05 | AutoMarket | Marketplace transactions subject to consumer protection law, seller liability, and potential platform liability | M | H | Legal review of marketplace operating terms before AutoMarket spec | AutoMarket | OPEN |
| R-L06 | Fixpert | Inspection report wording implies legal certification liability without professional PI insurance | M | H | Use "AutoCheck by Fixpert / Inspecté par Fixpert" — not "expertise légale certifiée" | AutoCheck | OPEN |
| R-L07 | All | Data retention periods for all categories not yet defined by legal review | H | M | Legal review of each category; no data deleted or retained without documented policy | All | OPEN |
| R-L08 | All | Cross-border data transfer or hosting outside Tunisia may create additional obligations | L | M | Review hosting model against applicable law before production deployment | Production | OPEN |
| R-L09 | AutoMarket | Completed transaction price collection and publication may require specific legal authorisation | M | M | Legal review before AVA-5/AutoMarket | AVA-5 | OPEN |
| R-L10 | Parts | Used spare-parts sales carry product liability and consumer protection obligations specific to this product category | M | M | Legal review of used-parts sales model before activation | Parts platform | OPEN |

---

## 2. Data and Identity Risks

| ID | Domain | Description | L | I | Mitigation | Blocking stage | Status |
|----|--------|-------------|---|---|-----------|----------------|--------|
| R-D01 | Ecosystem | Canonical vehicle_id is undefined at the ecosystem level; three products reference vehicles through ad-hoc integer columns with no cross-product merge/split semantics | H | H | Canonical identifier specification in MAE-1; vehicle_id merge/split propagation protocol required before IDA-2 and AVA-1 go live | IDA-2 | OPEN |
| R-D02 | ID Auto | Plate format rules are UNVERIFIED DRAFTS; public plate lookup results will contain errors until confirmed against official source | H | M | Plate format verification required before IDA-3 public launch; current flags: `verified = FALSE` | IDA-3 | OPEN |
| R-D03 | AutoValeur | AutoValeur Deal Radar flow describes creating a "preliminary fiche in ID Auto queue" — this must be implemented as an ingestion request submission, not a direct cross-schema write | M | H | Architecture audit finding incorporated; implementation must submit to ID Auto ingestion API | AVA-4 | OPEN |
| R-D04 | AutoValeur | Asking price and completed sale price conflation would corrupt the valuation model | M | H | AD-A3 enforced at schema level (separate columns); model governance requires separation permanently | AVA-3 | OPEN |
| R-D05 | ID Auto | Vehicle fiche merge creates orphaned references in AutoValeur and Fixpert if no propagation protocol exists | M | H | Merge/split event publication required; consumers must handle vehicle_id alias resolution | IDA-2 | OPEN |
| R-D06 | AutoValeur | AutoValeur references ssangyong.autos as "existing platform in Mythos ecosystem" in some docs and as external with LEGAL-REVIEW-REQUIRED in others | M | M | Clarification: ssangyong.autos is an external commercial system; its integration requires legal review and is not internal | AVA-2 | OPEN |

---

## 3. Technical and Architecture Risks

| ID | Domain | Description | L | I | Mitigation | Blocking stage | Status |
|----|--------|-------------|---|---|-----------|----------------|--------|
| R-T01 | Infrastructure | Shared PostgreSQL cluster + shared VPS with live Mythos OS production; a migration error or connection pool exhaustion in IDA-2/AVA-1 reaches production client data | H | H | Environment separation design required in MAE-1; staging must not share resources with production; migration plan requires explicit authorisation | IDA-2 | OPEN |
| R-T02 | Mythos OS | Stage 3G (Production Runtime) is flagged HIGH risk (30 routes, 19 storage keys); destabilising Mythos OS mid-integration with new products is the worst available sequencing | M | H | Stage 3G requires its own safe deployment window; automotive product stages must not be concurrent with 3G | IDA-2 / AVA-1 | OPEN |
| R-T03 | Integration | Scope column named `visibility_scope` in ID Auto docs and `access_scope` in AutoValeur — divergence will cause cross-product filter bugs | H | M | Standardise on `access_scope` as the canonical column name across all products; update ID Auto schema in IDA-2 | IDA-2 | OPEN |
| R-T04 | Integration | Rate limiting designed in ID Auto (IP hash + `idauto_verifications`) but only a placeholder in AutoValeur; two products will implement divergent rate-limit behaviours | M | M | Unified rate-limit service defined in MAE-1 shared platform spec; both products converge in IDA-2/AVA-1 | IDA-2 | OPEN |
| R-T05 | Integration | Audit envelope shape is product-specific (two independent tables); ecosystem audit stream has no schema | M | M | Common envelope specified in AUTOMOTIVE_INTEGRATION_CONTRACTS.md; implementation in MAE-1 | IDA-2 | OPEN |
| R-T06 | Architecture | Table naming in PostgreSQL schemas is redundant (e.g. `idauto.idauto_vehicles`) — carries MySQL-era prefix convention into PostgreSQL schema design | L | L | Decide naming convention before first migration; may rename prefix-inside-schema in IDA-2 | IDA-2 | OPEN |
| R-T07 | Infrastructure | PostgreSQL installation authority doubly stated: ID Auto says "before IDA-2"; AVA-1 also lists PostgreSQL as prerequisite | M | M | One shared cluster provisioned in IDA-2; AVA-1 is a consumer, not a separate installer | IDA-2 | OPEN |
| R-T08 | Roadmap | AVA-2 prerequisite incorrectly states "Fixpert Atelier IDA-2 inspection flow operational" — the Fixpert Atelier integration is IDA-4, not IDA-2 | H | M | Corrected in AUTOVALEUR_ROADMAP.md: AVA-2 prerequisite is IDA-4 | AVA-2 | OPEN |
| R-T09 | Architecture | No shared vehicle taxonomy API is defined; AutoValeur, AutoMarket, and Parts Network may each grow private lookup tables | M | M | ID Auto taxonomy API endpoint included in IDA-2 scope | IDA-2 | OPEN |

---

## 4. Operational Risks

| ID | Domain | Description | L | I | Mitigation | Blocking stage | Status |
|----|--------|-------------|---|---|-----------|----------------|--------|
| R-O01 | All | Backups not tested — a backup without a tested restore is no backup | M | H | Restore testing programme required before any product reaches PILOT; backup status registry required | All PILOT stages | OPEN |
| R-O02 | All | Secrets leakage — `google_config.php`, `ACCES.txt`, `appdata/`, `documents/` must never be committed | H | H | Committed constraints in AGENTS.md; pre-commit or CI check recommended | Immediate | OPEN |
| R-O03 | ID Auto / AutoValeur | Uncontrolled Mythos Super Admin access — no access review schedule or access revocation procedure | M | H | Periodic access review scheduled in Operating Model; all access audit-logged | IDA-2 | OPEN |
| R-O04 | All | Single-VPS dependency — all products on one VPS with no defined disaster recovery | M | H | Multi-site or cold-standby DR plan required before national-scale launch | Production scale | OPEN |
| R-O05 | All | Too many simultaneous product builds — team bandwidth and quality risk if IDA-2, AVA-1, 3G, and AutoMarket all begin concurrently | H | M | One major implementation stage rule enforced in Operating Model | All | OPEN |
| R-O06 | Parts / AutoValeur | External site integration instability — ssangyong.autos and future marketplace feeds are outside Mythos control; downtime or API changes break dependent product features | M | M | Authorised feed contracts with SLAs; graceful degradation when source unavailable | AVA-2 | OPEN |
| R-O07 | All | No incident response runbook exists for any product | M | M | Runbook required before each PILOT gate | All PILOT stages | OPEN |

---

## 5. Business and Market Risks

| ID | Domain | Description | L | I | Mitigation | Blocking stage | Status |
|----|--------|-------------|---|---|-----------|----------------|--------|
| R-B01 | All | Legal exposure as real critical path — 30+ LEGAL-REVIEW-REQUIRED items with no assigned owner or resolution date | H | H | Assign legal counsel; prioritise items blocking IDA-3, IDA-4, AVA-3, AVA-4; track in legal requirements registry | All | OPEN |
| R-B02 | AutoValeur | Inaccurate valuation causes financial harm — professional buyers or sellers making decisions on incorrect estimates | M | H | Clear disclaimer; confidence score displayed; accuracy monitoring; low comparable count shows lower confidence | AVA-1 | OPEN |
| R-B03 | AutoValeur | Manipulated listings — artificial pricing or duplicate listings corrupt the comparable engine | M | H | Outlier removal; source trust scoring; stale-listing decay; duplicate detection; human review of Deal Radar | AVA-3 | OPEN |
| R-B04 | Parts | Parts fitment errors — wrong parts specified for a vehicle cause customer harm | M | H | Fitment accuracy KPI; customer feedback loop; professional review of compatibility data | Parts platform | OPEN |
| R-B05 | Parts | Used spare-parts quality disputes — condition misrepresentation | M | M | Condition classification (new/used/refurbished); return policy; review programme | Parts platform | OPEN |
| R-B06 | AutoMarket | Marketplace fraud — fake listings, false identities, payment disputes | M | H | ID Auto vehicle verification required for listing; identity check badge; escrow or monitored payment; seller verification | AutoMarket | OPEN |
| R-B07 | All | Over-complex architecture — more services than the team can maintain | M | M | Simplest architecture that preserves modular boundaries; no component without demonstrated need | All | OPEN |
| R-B08 | Fixpert | Fixpert is a critical dependency with no document in this repository — no spec, no API contract, no schema | H | H | Fixpert integration spec required before IDA-4; separate Fixpert digital foundation specification | IDA-4 | OPEN |

---

## 6. Privacy and Data Protection Risks

| ID | Domain | Description | L | I | Mitigation | Blocking stage | Status |
|----|--------|-------------|---|---|-----------|----------------|--------|
| R-P01 | ID Auto / AutoValeur | Cross-product PII leakage — customer or owner PII inadvertently included in cross-product API response | M | H | Scope-filtered API responses; no PII columns in ID Auto vehicle/fact/observation tables; no PII columns in AutoValeur tables; verified by automated checks | IDA-2 | OPEN |
| R-P02 | ID Auto | Contributor identity leakage — contributor who submitted an observation identified from public output | M | M | Contributor identity is PROFESSIONAL+ scope; public output never includes contributor reference | IDA-3 | OPEN |
| R-P03 | AutoValeur | Deal Radar secrecy creates audit risk if acquisition intent is inferred from API access patterns | L | M | No public or professional API endpoint for deal alerts; MYTHOS_PRIVATE only; access audited | AVA-4 | OPEN |
| R-P04 | ID Auto | Carte grise OCR extracts owner PII in memory; must not persist to any idauto_ column | M | H | Architecture enforces: OCR → confirm → route to fixpert.clients or discard. `idauto_document_scans` has no PII columns | IDA-3 | OPEN |
| R-P05 | All | Vehicle movement as surveillance product — Smart Gate data or observation timestamps used to track individuals | L | H | Movement data is MYTHOS_PRIVATE; vehicle movements are never a public product; Deal Radar acquisition strategy never exposed publicly | All | OPEN |
