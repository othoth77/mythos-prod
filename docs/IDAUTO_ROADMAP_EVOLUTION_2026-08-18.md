# ID Auto — Roadmap Evolution Amendment (2026-08-18)

This document extends `docs/IDAUTO_ROADMAP.md`. Historical IDA-0 through IDA-3 records remain authoritative for implemented work.

## Strategic pivot

ID Auto evolves from a vehicle-intelligence application into an **Open Vehicle Identity & History Protocol**.

The application remains the reference implementation. The protocol becomes the interoperability layer.

## Strategic sequence

### IDA-4 — Citizen Vehicle Passport

Goal: make citizen-owned vehicle registration the primary public growth mechanism.

Planned:

- free vehicle registration
- stable IDauto Vehicle ID independent from VIN and owner identity
- Digital Vehicle Passport
- QR presentation
- public-safe passport projection
- ownership relationship model
- public fact gating by `access_scope` + `verification_status`
- citizen contribution UX
- legal/privacy gate before public activation

### IDA-5 — Professional Issuer Network

Goal: make garages and other trusted organisations verifiable issuers.

Planned:

- garage/organisation identity
- signed maintenance credentials
- issuer verification
- Atelier Network integration
- professional dashboards and APIs

### IDA-6 — AI Trust Engine

Goal: turn accumulated evidence into explainable intelligence.

Planned:

- document extraction
- mileage chronology analysis
- duplicate detection
- conflict detection
- part/vehicle consistency checks
- anomaly signals
- explainable Trust Score

AI outputs remain signals requiring verification, not legal/fraud determinations.

### IDA-7 — Credential Interoperability

Goal: make vehicle and professional records portable across implementations.

Planned:

- W3C Verifiable Credential schemas
- DID-compatible identity where justified
- issuer/verifier APIs
- external verification SDK
- protocol conformance suite

### IDA-8 — Cryptographic Anchoring

Goal: add tamper-evident public proof without moving operational data on-chain.

Planned:

- canonical record hashing
- Merkle batching
- chain-neutral anchor adapter
- proof verification endpoint
- public-chain or consortium anchor support

No cryptocurrency token is required.

### IDA-9 — Automotive Trust Network

Goal: connect the vehicle passport to the wider ecosystem.

Planned:

- dealers
- insurance
- fleet operators
- authorised inspection sources
- parts identity
- manufacturers
- cross-border vehicle passport support

## Non-goals

- whole database on Blockchain
- owner PII on public chain
- dependency on a single blockchain vendor
- token-first economics
- requiring consumers to understand Web3

## Primary network-growth loop

```text
Citizen registers vehicle
        ↓
Vehicle Passport + QR
        ↓
Garage adds verified maintenance
        ↓
Buyer checks passport
        ↓
Buyer registers next vehicle
        ↓
Network grows
```

## Strategic KPI

The north-star metric is **trusted vehicle coverage**:

- vehicles with passports
- verified records
- active professional issuers
- history continuity
- successful transfer events
- unresolved conflicts
- external protocol implementations

Raw user count remains a secondary metric.

## References

- `docs/IDAUTO_OPEN_VEHICLE_IDENTITY_PROTOCOL.md`
- `docs/IDAUTO_PRODUCT_SPEC.md`
- `docs/IDAUTO_CAPTURE_PIPELINE.md`
- `docs/IDAUTO_ARCHITECTURE.md`
- `docs/IDAUTO_FIXPERT_INTEGRATION.md`
- existing IDA-3 community ingestion implementation and review-gate history
