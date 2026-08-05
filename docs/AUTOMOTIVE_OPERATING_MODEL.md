# Mythos Automotive — Operating Model

**Stage:** MAE-0 Ecosystem Master Foundation
**Last updated:** 2026-08-05
**Repository:** othoth77/mythos-prod

---

## 1. Responsibilities

### 1.1 Mythos Prod

**Platform architecture:**
- Define and maintain ecosystem architecture decisions
- Govern shared services, integration contracts, and canonical identifiers
- Review and approve new product specifications
- Enforce the one-major-implementation-stage-at-a-time rule

**Platform engineering:**
- Operate shared PostgreSQL cluster, object storage, API gateway, audit stream
- Manage Mythos Core: auth, roles, permissions, billing, notifications, documents
- Maintain CI/CD pipeline and environment management

**Security and compliance governance:**
- Define security baseline and privacy standards
- Coordinate LEGAL-REVIEW-REQUIRED item resolution
- Conduct or commission security reviews before each PILOT stage
- Maintain secret management and access control

**Audit and administration:**
- Operate the Mythos Automotive Control Center (future)
- Conduct periodic Mythos Super Admin access reviews
- Manage incident response coordination
- Maintain backup and restore programme

### 1.2 Product Owner (per product)

**Product roadmap:**
- Define and prioritise the product roadmap within ecosystem constraints
- Manage product stage gates
- Accept or reject feature scope

**Business rules and data quality:**
- Define and maintain product-specific business rules
- Ensure data quality within the product domain
- Monitor and respond to model accuracy (AutoValeur), confidence degradation (ID Auto), etc.

**User experience:**
- Define product UX and interaction design
- Manage user acceptance testing

**Commercial model:**
- Define pricing, subscription terms, and partner agreements
- Manage product-specific billing configuration with Mythos billing service

### 1.3 Fixpert

**Workshop operations:**
- Day-to-day workshop management, appointments, interventions
- Inspection quality and technical accuracy
- Its own customers, invoices, and accounting
- Smart Gate camera device maintenance and access control

### 1.4 Parts Network Operator

**Catalogue operations:**
- Maintain the parts catalogue, fitment data, and supplier relationships
- Stock management and pricing
- Fulfilment operations

### 1.5 Legal / Data Protection

**Compliance ownership:**
- Maintain legal basis documentation for each data collection
- Draft and maintain consent frameworks
- Review and close LEGAL-REVIEW-REQUIRED items
- Handle data subject rights requests
- Maintain contracts with data sources (marketplace, official registries)
- Review inspection report liability wording
- Review Smart Gate ANPR regulatory requirements
- Review AutoValeur estimate disclaimer wording

### 1.6 Operations and Support

**Customer support:**
- First-line support for public and professional users
- Escalation path to product owners

**Professional onboarding:**
- Verify professional subscriber organisations
- Manage subscription lifecycle

**Incident escalation:**
- Detect and escalate production incidents
- Coordinate cross-product incidents

---

## 2. RACI Matrix

R = Responsible, A = Accountable, C = Consulted, I = Informed

| Activity | Mythos Platform | Product Owner | Fixpert | Parts | Legal | Support |
|----------|----------------|---------------|---------|-------|-------|---------|
| Product roadmap changes | C | A/R | I | I | C | I |
| Architecture changes | A/R | C | I | I | C | I |
| Data correction | I | R | R | R | C | R (triage) |
| Access grants (platform) | A/R | I | I | I | C | I |
| Access grants (product) | I | A/R | I | I | I | I |
| Incidents (platform) | A/R | I | I | I | I | I |
| Incidents (product) | C | A/R | C | C | I | R (triage) |
| Legal / GDPR requests | C | C | C | C | A/R | R (triage) |
| Model changes (AutoValeur) | I | A/R | I | I | C | I |
| Pricing changes | I | A/R | I | I | C | I |
| New integrations | A/R | C | C | C | C | I |
| Production releases | A/R | C | C | C | I | I |
| Security reviews | A/R | C | C | C | C | I |
| Backup/restore tests | A/R | I | I | I | I | I |
| Partner onboarding | C | A/R | I | I | C | R |

---

## 3. Stage Gates

Every product must pass gate requirements before advancing to the next status.

### 3.1 Foundation Gate

Required before status advances from CONCEPT to FOUNDATION:

- [ ] Product owner identified and confirmed
- [ ] Product purpose documented
- [ ] Data ownership boundaries defined
- [ ] Legal questions and LEGAL-REVIEW-REQUIRED items catalogued
- [ ] Architecture decisions documented
- [ ] Integration contracts identified
- [ ] Roadmap defined with stage dependencies

### 3.2 Build Gate

Required before active implementation begins (FOUNDATION → BUILD):

- [ ] Approved scope for this stage documented
- [ ] Test strategy defined
- [ ] Target environment available
- [ ] Secrets and backup design defined
- [ ] API contracts documented and versioned
- [ ] Acceptance criteria agreed

### 3.3 Pilot Gate

Required before limited deployment (BUILD → PILOT):

- [ ] Data used is authorised (synthetic, test, or legally cleared real data only)
- [ ] User group identified and consented
- [ ] Monitoring and alerting configured
- [ ] Support process defined
- [ ] Rollback plan documented and tested
- [ ] Blocking LEGAL-REVIEW-REQUIRED items for this stage resolved
- [ ] Security review conducted

### 3.4 Production Gate

Required before production deployment (PILOT/BETA → PRODUCTION):

- [ ] Security review passed
- [ ] Backup and restore test passed
- [ ] Monitoring and alerting active
- [ ] Incident runbook documented
- [ ] Privacy notice live (if applicable)
- [ ] Operational owner confirmed with on-call responsibilities
- [ ] SLA/SLO defined
- [ ] Release recorded in release registry

---

## 4. One Major Implementation Stage Rule

**Only one major implementation stage is active at a time unless explicitly authorised otherwise.**

"Major implementation stage" means: building new runtime code, deploying new services, executing database migrations, or connecting live data sources.

Documentation stages (MAE-0, IDA-1, AVA-0, etc.) may prepare multiple product tracks in parallel without violating this rule. Preparation does not mean implementation.

**Current application of this rule:**
- IDA-2 is the next authorised implementation stage
- AVA-1 depends on IDA-2 completing the shared PostgreSQL cluster
- Mythos OS Stage 3D → 3G (extraction) continues as its own track but HIGH risk (Stage 3G: 30 routes, 19 storage keys) — it must not be destabilised while new products are being integrated

---

## 5. Product Lifecycle

| Status | Description | Gate required |
|--------|-------------|---------------|
| CONCEPT | Planned product, not yet specified | None |
| FOUNDATION | Ownership, architecture, governance defined | Foundation gate |
| SPECIFIED | Fully specified, ready for build gate | |
| BUILD | Active implementation underway | Build gate |
| PILOT | Limited authorised deployment | Pilot gate |
| BETA | Wider deployment with active monitoring | |
| PRODUCTION | Live, monitored, backed up, supported | Production gate |
| PAUSED | Deprioritised or blocked | |
| RETIRED | No longer active | Retirement process |

---

## 6. Change Management

### 6.1 Architecture Changes

Any change to a master architecture decision (MAD-*) requires:
1. Proposal documenting: what changes, why, which products are affected, what is deprecated
2. Review by Mythos platform architect
3. Update to this file and affected product architecture documents
4. No unilateral product-level override of a master rule

### 6.2 Integration Contract Changes

Any change to a published integration contract requires:
1. New contract version (breaking changes = new major version)
2. Consumer notification before activation
3. Deprecation notice for old version
4. Parallel support period where feasible

### 6.3 Legal-Required Changes

Any change triggered by a LEGAL-REVIEW-REQUIRED item resolution requires:
1. Legal sign-off recorded in the legal requirements registry
2. Technical implementation via normal stage gate process
3. Update to the relevant LEGAL-REVIEW-REQUIRED lists

---

## 7. Incident Response Model

**First response:** Support triage detects or receives incident report.

**Escalation matrix:**

| Severity | Description | Response target | Escalation |
|----------|-------------|----------------|------------|
| P1 | Production down or data loss | Immediate | Platform + Product + Management |
| P2 | Major feature unavailable | 1 hour | Platform + Product owner |
| P3 | Degraded performance | 4 hours | Product owner |
| P4 | Minor issue | Next business day | Support |

**Post-incident:**
- Post-mortem required for P1 and P2
- Root cause documented in incident registry
- Preventive action tracked to completion

**Data breach:**
- LEGAL-REVIEW-REQUIRED — specific notification obligations depend on jurisdiction and data categories involved
- Incident registry records all PII-involving incidents
- Legal / Data Protection consulted immediately

---

## 8. Backup and Restore Programme

A backup is valid only after restoration is tested.

| Requirement | Description |
|-------------|-------------|
| Location | Outside the application VPS — separate storage |
| Frequency | Per product schedule (minimum daily for production) |
| Encryption | All backup files encrypted at rest |
| Retention | Per legal retention policy and operational need |
| Restore testing | Periodic restore in controlled test environment |
| Documentation | Backup status recorded in backup registry |
| Authorization | Never delete or replace a production backup without explicit authorisation |

---

## 9. Deployment Rules

- Never deploy uncommitted code
- Never deploy without a recorded release in the release registry
- Staging environment required for validation before production
- No real production data in staging without anonymisation authorisation
- Rollback capability documented before deployment
- Post-deployment smoke test required
- Permanent constraint: Do not touch `/var/www/uthinachess/0726/Prod/` or restart nginx/PHP without explicit authorisation

---

## 10. Partner Onboarding

Professional partner onboarding (garages, insurers, fleet operators) requires:
1. Organisation verification (registration number, professional licence where applicable)
2. Terms of service acceptance
3. Data processing agreement (DPA) — LEGAL-REVIEW-REQUIRED per partner type
4. Subscription activation via Mythos Core billing
5. Feature entitlement configured in Control Plane
6. Welcome and training documentation
7. Support contact assigned

---

## 11. Cross-Ecosystem Legal Review Register

The central legal requirement registry is managed by Mythos Core. It consolidates the 30+ LEGAL-REVIEW-REQUIRED items from ID Auto (13), AutoValeur (17), and future products.

Each item records:
- Item ID and description
- Blocking product stage
- Status: OPEN / IN_REVIEW / RESOLVED / WAIVED
- Legal counsel reference
- Resolution date (if resolved)
- Impacted products

All LEGAL-REVIEW-REQUIRED items are OPEN in MAE-0. No item is resolved by this documentation stage.
