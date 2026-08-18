# ID Auto — idauto.tn

**Product:** ID Auto  
**Domain:** idauto.tn  
**Platform:** Mythos ecosystem  
**Repository:** othoth77/mythos-prod (`projects/idauto/`, `docs/IDAUTO_*.md`)  
**Current strategic direction:** Open Vehicle Identity & History Protocol (2026-08-18)  
**Implementation history:** IDA-0 through IDA-3 engineering slices are recorded in the roadmap and handover.

---

## Vision

ID Auto is a progressively enriched vehicle intelligence platform for Tunisia evolving into an **Open Vehicle Identity & History Protocol**.

The long-term objective is to give every vehicle a portable digital identity and a progressively verified history while preserving privacy and legal boundaries.

The reference application is only one implementation. The protocol should eventually be usable by citizens, garages, dealers, insurers, fleets, inspectors, authorised institutions and independent developers.

Strategic specification: `docs/IDAUTO_OPEN_VEHICLE_IDENTITY_PROTOCOL.md`.

---

## Citizen-First Model

The core public proposition is free vehicle registration:

```text
Citizen
  ↓
Vehicle registration
  ↓
IDauto Vehicle ID
  ↓
Digital Vehicle Passport
  ↓
Observations / evidence / maintenance
  ↓
QR sharing
```

The citizen receives immediate utility: vehicle history, document organisation, maintenance tracking, anomaly signals and a shareable vehicle passport.

This is a network-growth mechanism, not a request for citizens to donate data for free without a product benefit.

---

## Vehicle Identity

Every vehicle eventually receives an IDauto-specific identifier, independent from the VIN and independent from the owner's identity.

Example:

`IDA-TN-xxxxxxxx`

The public vehicle identity must never become a public owner directory.

Ownership relationships are modelled separately so vehicle history can persist across ownership transfers without exposing previous owner's private data.

---

## Digital Vehicle Passport

The Vehicle Passport is a progressively enriched view of:

- vehicle identity
- plate history
- observations
- mileage history
- maintenance and repair events
- parts
- evidence/documents
- professional records
- institutional records where legally available
- verification state
- conflicts and anomalies
- provenance
- ownership-transfer history

The passport is not a single immutable database row. It is a governed projection over the underlying evidence and event history.

---

## Evidence and Trust

IDauto distinguishes source, evidence, verification and cryptographic integrity.

| Level | Meaning |
|---|---|
| T0 `SELF_DECLARED` | A person declared the information |
| T1 `DOCUMENTED` | Supporting evidence exists |
| T2 `PROFESSIONALLY_VERIFIED` | A verified professional confirms it |
| T3 `INSTITUTIONALLY_VERIFIED` | An authorised institution/source confirms it |
| T4 `CRYPTOGRAPHICALLY_ANCHORED` | A version has a cryptographic proof and timestamp anchor |

**Important:** cryptographic anchoring proves integrity of a recorded version. It does not prove that the original claimant told the truth.

---

## Privacy Contract

> **Public records must never expose owner name, address, phone number, national ID, insurance identity, or other protected personal information.**

This remains a founding, non-negotiable constraint.

Public projections must not expose raw VIN, exact observation location/time, original images, contributor identity, OCR output, or protected workshop/customer records unless a separately authorised policy explicitly permits it.

No raw owner PII or identity documents should be stored on a public blockchain.

---

## Three Access Scopes

### PUBLIC
Any caller within rate limits. Returns only approved public vehicle attributes and provenance/trust indicators.

### PROFESSIONAL
Verified professional organisations can access approved technical/service records within contractual scope. Organisations do not automatically see another organisation's private service records.

### MYTHOS_PRIVATE
Restricted operational/security data. Privileged access is audit-logged.

---

## Observation-First Model

Every capture or contribution creates an **Observation** first.

1. Search for an existing vehicle.
2. Add the new observation if a match exists.
3. Create a new vehicle fiche only when no match exists.
4. Extract facts with provenance.
5. Preserve conflicts and history.
6. Never silently overwrite an established fact.

The existing IDA-3 community-ingestion work extends this model to controlled public contribution, rate limiting, idempotency and human/automated review.

---

## Citizen Contribution

The citizen contribution path is intended to evolve toward:

```text
Submission
  ↓
Rate limit + idempotency
  ↓
Observation / evidence
  ↓
Review / corroboration
  ↓
Accepted / rejected / conflict
  ↓
Vehicle Passport update
```

User confirmation is evidence, not official verification. Independent reports remain independent evidence.

Public facts must be filtered by both access policy and verification state before they are served publicly.

---

## Professional Issuers

Garages are a primary network multiplier.

Future participating organisations should have stable organisational identities and be able to issue signed maintenance/service credentials.

Initial ecosystem relationship:

- ID Auto owns the vehicle identity layer.
- Each workshop organisation owns its own operational/customer data.
- Atelier Network provides the professional network structure.
- Fixpert is the first workshop pilot.

---

## AI Trust Engine

AI is an intelligence and verification-support layer, not an authority layer.

Potential functions:

- document extraction
- mileage chronology analysis
- duplicate detection
- VIN/document consistency checks
- part compatibility checks
- conflict analysis
- anomaly detection
- explainable Trust Score generation

AI anomalies must be surfaced as signals requiring verification rather than automatic accusations of fraud.

---

## Verifiable Credentials and Interoperability

IDauto should be compatible with W3C-oriented credential standards rather than creating a proprietary credential model.

References:

- W3C Verifiable Credentials: https://www.w3.org/TR/vc-data-model/
- W3C Decentralized Identifiers: https://www.w3.org/TR/did/
- MOBI standards / Vehicle Identity: https://dlt.mobi/standards/

DID-compatible identifiers are adopted only where they provide real interoperability value.

---

## Blockchain Position

Blockchain is a **trust/integrity/timestamping layer**, not the IDauto operational database.

Operational data remains off-chain in PostgreSQL/object storage. Blockchain may receive cryptographic commitments such as hashes or Merkle roots.

```text
Vehicle Event
   ↓
Canonical Record
   ↓
Hash / Batch
   ↓
Merkle Root
   ↓
Blockchain Anchor
```

The protocol must remain chain-neutral and must not require a cryptocurrency token.

---

## QR and Sharing

Each Vehicle Passport should expose a QR representation that resolves to a current public-safe presentation.

The QR itself is not the vehicle identity. It is a portable discovery/share mechanism.

A buyer should eventually be able to scan a vehicle QR and inspect its available history without seeing the seller's private identity.

---

## Open Source Strategy

The protocol layer should be open:

- schemas
- provenance model
- trust semantics
- credential formats
- QR format
- verification algorithms
- API contract
- reference verifier
- conformance tests

Hosted services, AI operations, enterprise integrations and managed infrastructure may remain commercial.

**Open protocol does not mean open personal data.**  
**Open source does not mean open trademark.**

---

## Commercial Direction

Citizen core: free-first.  
Professional: subscriptions and verification services.  
Enterprise: APIs, integrations, private deployments and support.  
Premium citizen services: advanced reports, AI analysis and sale-ready passport.

A token sale is not required to validate the network.

---

## Marketing Principle

Consumer messaging should focus on automotive value, not Blockchain terminology.

Preferred positioning:

- **Know the history before you buy.**
- **Keep your car's digital history from day one.**
- **Sell your car with a verifiable digital passport.**

The main growth loop is:

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
```

The strategic metric is trusted vehicle coverage, not raw account count.

---

## Existing Engineering Baseline

The repository already contains substantial ID Auto engineering work, including:

- observation-first PostgreSQL model
- vehicle/plate/fact/evidence structures
- read and write API reference implementation
- atomic audit logging
- identity stub and platform identity alignment work
- local content-addressed media storage
- community ingestion architecture
- PostgreSQL-backed rate limiting
- private/admin ingestion
- review queue and visibility gates
- media backup/restore and integrity tooling
- ID Auto-specific test-impact mapping

These implemented stages remain authoritative. The new open-protocol direction is an extension of the product strategy, not a claim that all future components are already implemented.

---

## Legal Gate

Existing ID Auto legal-review requirements remain binding before activating regulated features, including public vehicle/plate lookup, public image contribution, precise GPS, carte grise OCR, owner-related processing, ANPR/Smart Gate, retention, professional data sharing and correction/deletion workflows.

Blockchain does not remove those requirements.

---

## Canonical Strategic Definition

> **IDauto is an open, portable and verifiable identity and history layer for vehicles — citizen-first, provenance-driven, privacy-preserving, AI-assisted and blockchain-anchorable.**

The full strategic amendment is in `docs/IDAUTO_OPEN_VEHICLE_IDENTITY_PROTOCOL.md`.

---

## Current Strategic Next Steps

1. Freeze the protocol vocabulary and Vehicle Passport schema.
2. Align the existing community ingestion model with the public passport projection.
3. Close the verification-status/public-serving gate identified during IDA-3.
4. Define the citizen registration UX and QR passport contract.
5. Define professional issuer and garage credentials.
6. Design VC/DID interoperability without replacing the current database model.
7. Design a chain-neutral anchoring adapter before choosing a blockchain network.
8. Keep public launch behind the existing legal and privacy gates.
