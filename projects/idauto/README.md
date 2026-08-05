# ID Auto — idauto.tn

**Product:** ID Auto  
**Domain:** idauto.tn  
**Repository:** othoth77/mythos-prod (`projects/idauto/`)  
**Stage:** IDA-0 Foundation (2026-08-05)  
**Status:** Planning

---

## Overview

ID Auto is a vehicle-plate lookup and professional subscription platform for Tunisia. It provides:

- **Public plate search** — anyone can look up a Tunisian plate number and receive vehicle attributes (make, model, year, fuel type, category). Owner name, address, phone, national ID, insurance identity and all other personal information are never returned.
- **Professional subscription layer** — verified organizations (mechanics, garages, insurers, fleet managers, judicial officers) gain access to service-event history and higher-rate API calls, subject to contractual legal basis and consent records.

---

## Privacy Contract

This is the founding, non-negotiable constraint of the product.

> **Public records must never expose owner name, address, phone number, national ID, insurance identity, or any other protected personal information.**

The public search endpoint returns only:
- Plate number (as queried)
- Vehicle make, model, year, body type, fuel category, colour (where recorded in official public registries)
- Plate validity status (active / suspended / cancelled)
- Governorate of registration

It does not return, and the schema does not store in a queryable-by-plate path:
- Owner full name
- Owner address or locality beyond governorate
- National ID number (CIN) or passport number
- Insurance policy number or insurer identity
- Phone or email of registered owner
- Date of birth

Professional subscribers may annotate their own service events (service history recorded by the professional on vehicles they serviced) but may not retrieve third-party owner PII via the platform.

---

## Plate Format Rules

Tunisian vehicle plate formats are defined as configurable rules in `config/idauto.example.json`. No format is hardcoded; the running configuration can be updated as the Tunisian traffic authority introduces new series without a code change.

Current format families tracked:

| Code | Name | Example | Notes |
|------|------|---------|-------|
| `TUN_STD` | Standard passenger | `123 TUN 4567` | Main series since 2002 |
| `TUN_OLD` | Legacy passenger | `1234 TUN 56` | Pre-2002 series, still in circulation |
| `TUN_GVT` | Government | `GN 123 456` | Ministries and public entities |
| `TUN_DIP` | Diplomatic / CD | `CD 12 345` | Diplomatic corps |
| `TUN_MIL` | Military | `ARN 123456` | Armed forces |
| `TUN_TMP` | Temporary / transit | `TT 12345 A` | Short-term registration |
| `TUN_ECO` | Economic zones / special | varies | Free-trade and industrial zones |

---

## Separation from Mythos OS Storage

ID Auto data lives in an entirely separate storage namespace:

- Database prefix: `idauto_` (never shares tables with Mythos OS `mp_` prefix)
- No cross-reads between Mythos OS STORE and ID Auto data at the data layer
- Shared services (auth, permissions, billing, audit) are consumed via defined integration contracts — see `docs/IDAUTO_ARCHITECTURE.md`

---

## Scope Exclusions — IDA-0

The following are explicitly out of scope for this foundation stage:

- Real vehicle data ingestion or scraping
- Real plate data of any living person
- Any UI or front-end code
- Deployment to idauto.tn or any server
- Payment processing or subscription billing
- Integration with any external registry API
- Any personal data exposure or processing

---

## Repository Layout

```
projects/idauto/
├── README.md                  ← this file
├── config/
│   └── idauto.example.json   ← configurable plate-format rules and feature flags
└── database/
    └── schema.sql            ← data contracts (no real data)

docs/
├── IDAUTO_ARCHITECTURE.md    ← integration contracts and architecture decisions
└── IDAUTO_ROADMAP.md         ← ID Auto stage roadmap
```

---

## Next Stage

**IDA-1 — Product and Legal Specification**

Define the legal basis for each data category under Tunisian law (organic law 63-2004 on personal data protection and its successors), GDPR adequacy considerations for EU-facing professional users, the consent flow for professional subscribers, and the regulatory framework for accessing public vehicle registry data.
