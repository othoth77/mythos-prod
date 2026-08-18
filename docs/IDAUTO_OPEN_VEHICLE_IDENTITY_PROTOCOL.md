# ID Auto — Open Vehicle Identity Protocol Strategy

**Date:** 2026-08-18  
**Status:** Strategic amendment and design direction  
**Product:** ID Auto  
**Domain:** idauto.tn  
**Repository:** `othoth77/mythos-prod` (`projects/idauto/`)  
**Implementation status:** This document records the strategic evolution only. It does not by itself authorise public launch, blockchain deployment, new database migrations, legal activation, or production mutation.

---

## 1. Strategic Evolution

ID Auto began as a progressively enriched vehicle-intelligence platform for Tunisia. The existing repository already implements the observation-first model, vehicle/fact provenance, public/professional/private access scopes, controlled community ingestion, review workflows, professional boundaries, audit logging, and operational safety foundations.

The next strategic evolution is to make ID Auto an **Open Vehicle Identity & History Protocol** rather than only a closed application.

### Canonical product definition

> **IDauto is an open protocol and trust infrastructure for giving every vehicle a portable digital identity and a progressively verified history.**

The application remains the reference implementation. The protocol becomes the long-term public interface that other applications, garages, dealers, insurers, inspectors, manufacturers and authorised institutions can implement.

This evolution extends the existing work; it does not replace the existing observation-first data model.

---

## 2. Citizen-First Network Strategy

The primary growth mechanism is citizen participation.

Any citizen should eventually be able to register a vehicle for free and create an IDauto Vehicle Passport without waiting for a government integration or a manufacturer partnership.

Target flow:

```text
Citizen
  ↓
Create IDauto account / session
  ↓
Register vehicle
  ↓
Create Vehicle ID
  ↓
Create Digital Vehicle Passport
  ↓
Add observations, documents and maintenance history
  ↓
Receive QR code
  ↓
Share a verifiable vehicle profile when needed
```

The first user value is immediate:

- vehicle identity
- maintenance history
- document organisation
- mileage history
- evidence-backed records
- anomaly detection
- QR-based sharing
- sale-ready vehicle report

The citizen is therefore not merely a data source. The citizen receives a useful product in exchange for contributing data.

---

## 3. Vehicle Identity

Each registered vehicle receives an IDauto-specific identifier that is distinct from government registration identifiers and distinct from the VIN.

Example:

`IDA-TN-xxxxxxxx`

The identifier is the stable reference used by the protocol.

### Separation of identities

```text
Vehicle Identity
├── IDauto Vehicle ID
├── VIN (protected)
├── Registration/plate references
└── Technical identity

Owner Identity
├── User identity
├── Ownership relationship
└── Private credentials
```

The public vehicle identity must not become a public owner directory.

A vehicle's technical history can persist across ownership transfers while previous owner's personal information remains separately protected.

---

## 4. Digital Vehicle Passport

Every IDauto vehicle should eventually have a portable **Digital Vehicle Passport**.

The passport is a structured view of the vehicle's history, not a single immutable document.

It aggregates:

- vehicle identity
- plate history
- observations
- mileage observations
- maintenance events
- repair events
- part records
- documents/evidence references
- inspection records
- accident-related records where legally available
- ownership-transfer events
- verification state
- anomaly signals
- provenance information

The passport is progressively enriched rather than completed in one transaction.

---

## 5. Evidence and Trust Model

IDauto must never present every claim as equally authoritative.

The protocol therefore adopts a source-aware trust ladder.

| Level | Label | Meaning |
|---|---|---|
| T0 | `SELF_DECLARED` | A person declared the information |
| T1 | `DOCUMENTED` | A supporting document/evidence item exists |
| T2 | `PROFESSIONALLY_VERIFIED` | A verified professional confirms the record |
| T3 | `INSTITUTIONALLY_VERIFIED` | An authorised institution/source confirms it |
| T4 | `CRYPTOGRAPHICALLY_ANCHORED` | The record/version has a cryptographic proof and timestamp anchor |

### Critical rule

**T4 does not mean T3. Blockchain anchoring proves integrity of a recorded version; it does not prove that the original claimant told the truth.**

The protocol therefore keeps these concepts separate:

```text
Source
Evidence
Verification
Cryptographic integrity
```

Never collapse them into one generic `verified=true` flag.

---

## 6. Observation-First Remains the Core

The new protocol does not replace the existing observation-first design.

Every external claim continues to enter as an observation or evidence-backed event, after which IDauto:

1. resolves the vehicle identity
2. records provenance
3. extracts facts
4. compares them with prior facts
5. preserves conflicts
6. applies verification rules
7. determines visibility according to `access_scope`
8. exposes only the appropriate projection

**No silent overwrite of established history.**

Independent reports of the same event remain independent evidence even when their byte payloads are deduplicated.

---

## 7. Public Citizen Contribution

The existing IDA-3 community-ingestion design is the foundation for this direction.

The intended public contribution model becomes:

```text
Citizen submission
      ↓
Rate limit
      ↓
Idempotency
      ↓
Evidence normalization
      ↓
Observation / claim
      ↓
Review / corroboration
      ↓
Accepted / rejected / conflict
      ↓
Vehicle Passport update
```

### Contribution rules

- Anonymous contribution may exist where legally permitted and appropriately rate-limited.
- Authenticated contributors receive a stronger accountability and trust model.
- User confirmation is evidence, not official verification.
- Independent reporters remain separate sources.
- Low-confidence and conflicting claims enter review instead of silently altering the passport.
- Public endpoints must filter by both `access_scope` and `verification_status` before serving a fact publicly.

This last rule is explicitly recorded because the IDA-3 implementation history identified the risk of serving a public-scoped but still-unreviewed fact.

---

## 8. QR as the Human Interface

Each Vehicle Passport should have a QR representation.

The QR is not the identity itself. It resolves to a current IDauto vehicle presentation.

Example public presentation:

```text
IDauto Vehicle Passport

Vehicle: IDA-TN-xxxxxxxx
Make / Model: Verified
Mileage history: Consistent / Review required
Maintenance: 12 records
Professional records: 8
Evidence-backed records: 10
Anomalies: 1
Trust indicators: See provenance

[Share] [Report] [Transfer]
```

The QR must never expose owner PII or protected source material by default.

---

## 9. Professional Issuers

Garages are a major network multiplier.

Each participating professional organisation should eventually have its own stable organisational identity and signing capability.

Example:

`GAR-TN-000182`

A garage can issue a maintenance credential or signed event:

```text
Garage
  ↓
Maintenance event
  ↓
Evidence
  ↓
Professional signature
  ↓
IDauto Vehicle Passport
```

Professional records are not equivalent to official records. Their provenance must remain explicit.

### Target professional network

- garages
- repair workshops
- inspectors
- dealers
- insurers
- fleets
- authorised field teams
- authorised government entities
- parts suppliers

This aligns with the existing Atelier Network direction: ID Auto owns the vehicle identity layer while each workshop organisation retains ownership of its own operational/customer data.

---

## 10. Verifiable Credentials and Decentralized Identity Compatibility

IDauto should be compatible with W3C-oriented identity primitives rather than inventing a proprietary credential format.

### Intended model

```text
Issuer
  ↓
Verifiable Credential
  ↓
Holder / Vehicle Passport
  ↓
Verifier
```

Potential credential issuers:

- professional garage
- inspection provider
- authorised institution
- manufacturer
- IDauto itself for platform-level attestations

Potential verifiers:

- vehicle buyer
- dealer
- insurer
- garage
- marketplace
- institution

DID-compatible identifiers may be introduced where they provide actual interoperability value. The protocol should not adopt decentralized identifiers merely for branding reasons.

Reference standards:

- W3C Verifiable Credentials: https://www.w3.org/TR/vc-data-model/
- W3C Decentralized Identifiers: https://www.w3.org/TR/did/
- MOBI standards: https://dlt.mobi/standards/

---

## 11. Blockchain Strategy

Blockchain is an **integrity and timestamping layer**, not the primary IDauto database.

### Off-chain

Store:

- vehicle records
- documents
- images
- evidence metadata
- user data
- operational state
- review state
- analytics

### Anchored proof

Store on-chain only what is necessary to prove a canonical record/version existed and has not been altered after anchoring:

- record identifier
- pseudonymous vehicle reference where needed
- content hash
- Merkle root or batch hash
- timestamp
- issuer/signing reference
- status/revocation reference where necessary

### Privacy rule

Never place raw owner PII, raw identity documents, raw images, or unnecessary vehicle identifiers on a public blockchain.

### Batch strategy

Do not create one public-chain transaction per vehicle event.

Use batching:

```text
Record 1
Record 2
Record 3
...
Record N
      ↓
Merkle tree / batch commitment
      ↓
Root hash
      ↓
Blockchain anchor
```

This reduces cost and keeps personal data off-chain.

### Network neutrality

The IDauto protocol must not be permanently bound to one blockchain vendor. The anchoring interface should allow different public or consortium anchors without changing the vehicle-history protocol.

No IDauto token or cryptocurrency is required for the core product.

---

## 12. AI Trust Engine

AI becomes the intelligence layer above the evidence model.

It should extract and compare, not manufacture facts.

### Document intelligence

From invoices, service reports and supported documents, AI may extract:

- date
- mileage
- vehicle reference
- garage
- part reference
- amount
- work performed
- document reference

### Anomaly detection

AI should flag:

- inconsistent mileage chronology
- impossible dates
- duplicate invoices
- one invoice attached to multiple vehicles
- VIN/document mismatch
- incompatible part/vehicle combinations
- suspicious repeated patterns
- conflicting technical facts

The output must be a **risk signal**, not an accusation.

Example:

> `Mileage chronology inconsistency detected — confidence 94%. Verification required.`

Never convert an AI anomaly directly into a fraud assertion.

---

## 13. Trust Score

A vehicle may eventually receive a transparent **IDauto Trust Score**.

The score must be explainable and never directly purchasable.

Illustrative dimensions:

```text
Identity completeness
Mileage consistency
Evidence coverage
Professional verification
Institutional verification
Conflict/anomaly penalty
History continuity
```

The score is a presentation layer derived from underlying provenance and verification; the underlying records remain authoritative.

A professional subscription or advertising spend must never buy a higher trust score.

---

## 14. Ownership Transfer

Ownership changes are separate from vehicle history.

```text
Vehicle Identity
       │
       ├── Owner A relationship
       ├── Ownership transfer
       └── Owner B relationship
```

Transfer should preserve vehicle history while limiting exposure of previous owner's private data.

The future transfer flow:

```text
Current owner
  ↓
Transfer request
  ↓
Buyer accepts
  ↓
Ownership credential updated
  ↓
Vehicle Passport retained
```

---

## 15. Open Source Strategy

IDauto should become open at the **protocol layer**, not necessarily at every service layer.

### Open

- protocol specification
- vehicle schema
- event schema
- provenance model
- verification model
- credential schemas
- QR format
- verification algorithms
- reference verifier
- API contract
- conformance tests

### Controlled / commercial

- hosted service
- AI models and operational pipelines
- enterprise integrations
- managed infrastructure
- premium reports
- enterprise support
- proprietary risk intelligence where appropriate

The open protocol must not require permission from the IDauto operator for independent implementations.

Recommended default code licence for protocol/reference code: permissive open-source licensing such as Apache-2.0, subject to a later legal/IP review.

**Open protocol does not mean open personal data.**

**Open source does not mean open trademark.**

---

## 16. API and Interoperability Principles

The API must be designed around protocol objects rather than UI pages.

Core nouns:

- `vehicle`
- `plate`
- `observation`
- `fact`
- `evidence`
- `maintenance_event`
- `part`
- `credential`
- `issuer`
- `ownership_event`
- `verification`
- `anchor`

An external implementation should be able to create and verify a Vehicle Passport without using the IDauto web application.

The protocol should provide machine-readable:

- schemas
- enumerations
- signatures
- trust semantics
- error semantics
- versioning
- compatibility rules

---

## 17. Data Architecture Direction

Target conceptual architecture:

```text
                   IDauto Protocol
                         │
          ┌──────────────┼──────────────┐
          │              │              │
       Citizen        Garage          Dealer
          │              │              │
          └──────────────┼──────────────┘
                         │
                 Identity / VC Layer
                         │
                  Vehicle Passport
                         │
       ┌─────────────────┼─────────────────┐
       │                 │                 │
   Observations       Evidence          Events
       │                 │                 │
       └─────────────────┼─────────────────┘
                         │
                    Trust Engine
                   /     │      \
                 AI    Rules   Human Review
                   \     │      /
                    Verification
                         │
                  Operational Storage
                         │
                 Hash / Merkle Batches
                         │
                  Blockchain Anchors
```

The existing PostgreSQL operational model remains suitable as the transactional system of record. Blockchain does not replace PostgreSQL.

---

## 18. Commercial Model

The citizen-facing core should be free-first.

### Free

- vehicle registration
- Vehicle Passport
- QR
- basic maintenance history
- document organisation
- basic reminders

### Premium citizen services

- advanced vehicle report
- AI history analysis
- valuation support
- anomaly report
- sale-ready passport

### Professional

- garage account
- verified service events
- professional credentials
- workshop dashboards
- API access
- customer-facing passport tools

### Enterprise

- insurance integration
- fleet integrations
- dealer integration
- OEM integrations
- institutional APIs
- private deployments
- SLA/support

No token sale is required to validate the network.

---

## 19. Growth and Marketing Architecture

Marketing is part of the product strategy because the protocol becomes more valuable as more vehicles and trusted issuers participate.

### Citizen message

Primary value propositions should be expressed in automotive language, not blockchain language:

- **Know the history before you buy.**
- **Keep your car's digital history from day one.**
- **Sell your car with a verifiable digital passport.**

Avoid making Blockchain, DID or Web3 the primary consumer message.

### Network loop

```text
Free citizen registration
       ↓
Vehicle Passport
       ↓
QR sharing
       ↓
Garage adds verified service
       ↓
Buyer checks passport
       ↓
Buyer registers next vehicle
       ↓
New vehicle enters network
```

### Distribution priorities

1. Citizens / vehicle owners
2. Garages and workshop networks
3. Dealers and marketplaces
4. Insurers and fleets
5. Authorised institutions
6. Manufacturers / international partners

The garage network is especially important because one professional partner can contribute records to many vehicles.

---

## 20. Trust Network, Not Just User Growth

The success metric should not be only:

`number_of_users`

The stronger network metrics are:

- vehicles with passports
- active passports
- verified records per vehicle
- professionally verified events
- institutional records
- percentage of vehicles with continuous history
- number of participating professional issuers
- successful ownership transfers
- buyer report usage
- percentage of facts with provenance
- unresolved conflicts
- anomaly resolution rate
- external protocol implementations

The core strategic metric is **trusted vehicle coverage**, not raw account count.

---

## 21. Legal and Privacy Gate

The existing ID Auto legal-review list remains binding.

No strategic expansion cancels the existing requirement for formal review before activating features involving:

- public vehicle/plate lookup
- public image contribution
- precise GPS
- carte grise OCR
- owner-related data
- ANPR / Smart Gate
- data retention
- professional data sharing
- deletion/correction rights

Blockchain adds an additional design requirement: **data that may need correction or deletion must not be written to immutable public storage in identifiable form.**

Privacy-by-design therefore requires:

- off-chain personal data
- pseudonymous/public vehicle references where appropriate
- selective disclosure
- revocation/status mechanisms
- data minimisation
- explicit separation of vehicle identity and owner identity

---

## 22. Security Principles

The protocol must preserve the security rules already established in the repository:

- fail closed on missing identity/authorization
- audit privileged mutation
- rate-limit public ingestion
- resolve idempotency before consuming quota on retries
- parameterized SQL only
- no raw provider errors to public clients
- no secret values in Git
- no owner PII in public vehicle schemas
- independent evidence remains independent
- no silent historical overwrite
- backups before storing non-disposable evidence

Blockchain must not be used as an excuse to weaken these controls.

---

## 23. Roadmap Evolution

The existing IDA-0 through IDA-3 history remains authoritative for implemented work. This document defines the strategic direction for the stages that follow.

### IDA-3 — Community Ingestion

**Repository state:** engineering slices through the community-ingestion foundation are already implemented, including rate limiting, private ingestion, review queue and visibility controls.

### IDA-4 — Open Vehicle Passport and Public Network MVP

Planned scope:

- citizen vehicle registration
- public/private passport projections
- QR generation
- verified/public fact gating
- contributor UX
- ownership relationship model
- protocol schema v1
- first public-facing report

Legal gate remains mandatory before public activation.

### IDA-5 — Professional Issuer Network

Planned scope:

- garage identities
- professional credentials
- signed maintenance events
- issuer verification
- Atelier Network integration
- professional dashboards

### IDA-6 — AI Trust Engine

Planned scope:

- document extraction
- chronology analysis
- duplicate detection
- conflict analysis
- explainable Trust Score

### IDA-7 — Verifiable Credentials / Interoperability

Planned scope:

- credential schemas
- issuer/verifier APIs
- DID-compatible identifiers where justified
- external verification SDK
- protocol conformance tests

### IDA-8 — Cryptographic Anchoring

Planned scope:

- canonical record hashing
- Merkle batching
- blockchain anchor adapter
- verification endpoint
- chain-agnostic anchor interface

### IDA-9 — Ecosystem and Internationalisation

Planned scope:

- dealer integrations
- insurance integrations
- institutional sources
- parts identity
- cross-border vehicle passport support
- multiple jurisdictions

These stages are strategic targets, not implementation authorization by themselves.

---

## 24. Non-Goals

The following are explicitly not required for the core IDauto strategy:

- launching a cryptocurrency
- issuing a speculative token
- putting the whole database on-chain
- storing owner PII on a public chain
- requiring citizens to understand Blockchain
- replacing PostgreSQL with Blockchain
- treating immutable records as automatically truthful
- forcing all partners onto one blockchain vendor
- building a closed protocol that only the IDauto web application can use

---

## 25. Acceptance Criteria for the Strategic Direction

Before calling the Open Vehicle Identity Protocol strategy production-ready, the repository should be able to demonstrate:

1. A citizen can create a vehicle passport without a professional partner.
2. The vehicle identifier is independent from the owner's identity.
3. Every factual claim has provenance and a verification state.
4. Public APIs refuse unverified public facts when the policy requires verification.
5. A professional issuer can sign a maintenance event.
6. A vehicle passport survives an ownership transfer without exposing the prior owner's private data.
7. A QR code resolves to a safe public vehicle presentation.
8. AI anomalies are labelled as signals requiring verification, not as truth.
9. The protocol can be implemented without using the reference UI.
10. Public blockchain anchoring can be enabled without moving raw personal data on-chain.
11. The anchoring layer can be replaced without changing vehicle-history semantics.
12. The protocol and reference implementation have conformance tests.
13. Legal/privacy gates are documented and passed before public activation of regulated features.

---

## 26. Canonical Principle

IDauto should not become **"a Blockchain database of cars."**

It should become:

> **An open, portable and verifiable identity and history layer for vehicles — citizen-first, provenance-driven, privacy-preserving, AI-assisted and blockchain-anchorable.**

`Blockchain` is one trust primitive.  
`AI` is the intelligence layer.  
`Verifiable Credentials` are the interoperability layer.  
`PostgreSQL/object storage` remain the operational data layer.  
`Citizens and trusted professionals` create the network effect.  
`The open protocol` is the long-term moat.

---

## 27. Research References

The following standards/projects should be treated as external reference material for future design reviews, not as adopted dependencies:

- W3C Verifiable Credentials: https://www.w3.org/TR/vc-data-model/
- W3C Decentralized Identifiers: https://www.w3.org/TR/did/
- MOBI standards / Vehicle Identity work: https://dlt.mobi/standards/
- DIMO: https://dimo.org/
- Gaia-X Trust Framework: https://docs.gaia-x.eu/technical-committee/architecture-document/latest/trust_framework_architecture/
- EU Digital Product Passport / Batteries: https://single-market-economy.ec.europa.eu/single-market/digital-product-passport/batteries_en
- Tunisia INPDP: https://www.inpdp.tn/

All future decisions must still be validated against the current legal, technical and operational state of the repository and deployment environment.
